-- MiniPort production hardening: security, OTP verification, GPS, audit and payment integrity.
-- Idempotent. Apply through the normal Supabase migration pipeline.

-- Role self-promotion: only customer can be self-inserted; driver/admin are admin/service-role controlled.
DROP POLICY IF EXISTS "Roles: insert self customer/driver" ON public.user_roles;
DROP POLICY IF EXISTS "Roles: insert self customer only" ON public.user_roles;
CREATE POLICY "Roles: insert self customer only" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND role = 'customer'::public.app_role);

-- Canonical booking side-effect triggers: exactly one of each.
DROP TRIGGER IF EXISTS trg_bookings_award_coins ON public.bookings;
DROP TRIGGER IF EXISTS bookings_award_coins ON public.bookings;
DROP TRIGGER IF EXISTS zz_bookings_award_coins ON public.bookings;
CREATE TRIGGER zz_bookings_award_coins BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_award_coins();

DROP TRIGGER IF EXISTS trg_bookings_debit_coins ON public.bookings;
DROP TRIGGER IF EXISTS zz_bookings_debit_coins ON public.bookings;
DROP TRIGGER IF EXISTS bookings_debit_coins ON public.bookings;
CREATE TRIGGER bookings_debit_coins BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_debit_coins();

DROP TRIGGER IF EXISTS trg_bookings_generate_otps ON public.bookings;
DROP TRIGGER IF EXISTS bookings_generate_otps ON public.bookings;
CREATE TRIGGER bookings_generate_otps BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_generate_otps();

DROP TRIGGER IF EXISTS bookings_enqueue_sms ON public.bookings;
DROP TRIGGER IF EXISTS zzz_bookings_enqueue_sms ON public.bookings;
CREATE TRIGGER zzz_bookings_enqueue_sms AFTER UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enqueue_sms_for_booking();

DROP TRIGGER IF EXISTS bookings_touch_updated_at ON public.bookings;
DROP TRIGGER IF EXISTS bookings_touch ON public.bookings;
CREATE TRIGGER bookings_touch BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Payment idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_order_id
  ON public.payments(provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_payment_id
  ON public.payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL;

-- Real driver GPS.
CREATE TABLE IF NOT EXISTS public.driver_locations (
  driver_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  accuracy_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Driver manages own location" ON public.driver_locations;
CREATE POLICY "Driver manages own location" ON public.driver_locations FOR INSERT TO authenticated
  WITH CHECK(driver_id=auth.uid() AND public.has_role(auth.uid(),'driver'::public.app_role));
DROP POLICY IF EXISTS "Driver updates own location" ON public.driver_locations;
CREATE POLICY "Driver updates own location" ON public.driver_locations FOR UPDATE TO authenticated
  USING(driver_id=auth.uid()) WITH CHECK(driver_id=auth.uid());
DROP POLICY IF EXISTS "Customers read assigned driver location" ON public.driver_locations;
CREATE POLICY "Customers read assigned driver location" ON public.driver_locations FOR SELECT TO authenticated USING(
  public.has_role(auth.uid(),'admin'::public.app_role) OR driver_id=auth.uid() OR EXISTS(
    SELECT 1 FROM public.bookings b WHERE b.driver_id=driver_locations.driver_id
      AND b.customer_id=auth.uid() AND b.status IN ('accepted'::public.booking_status,'in_progress'::public.booking_status)
  )
);
CREATE INDEX IF NOT EXISTS idx_driver_locations_updated ON public.driver_locations(updated_at DESC);

-- Secure OTP verification RPCs. Clients cannot write verification timestamps directly.
CREATE OR REPLACE FUNCTION public.verify_pickup_otp(_booking_id uuid, _otp text)
RETURNS public.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE b public.bookings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver'::public.app_role) THEN RAISE EXCEPTION 'Driver only'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR b.driver_id IS DISTINCT FROM auth.uid() OR b.status <> 'accepted'::public.booking_status THEN RAISE EXCEPTION 'Trip is not ready for pickup verification'; END IF;
  IF b.pickup_otp IS NULL OR _otp IS NULL OR b.pickup_otp <> regexp_replace(_otp,'\D','','g') THEN RAISE EXCEPTION 'Invalid pickup OTP'; END IF;
  UPDATE public.bookings SET pickup_verified_at=now(), status='in_progress'::public.booking_status WHERE id=_booking_id RETURNING * INTO b;
  RETURN b;
END;$function$;

CREATE OR REPLACE FUNCTION public.verify_drop_otp(_booking_id uuid, _otp text, _pod_photo_url text DEFAULT NULL)
RETURNS public.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE b public.bookings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver'::public.app_role) THEN RAISE EXCEPTION 'Driver only'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR b.driver_id IS DISTINCT FROM auth.uid() OR b.status <> 'in_progress'::public.booking_status THEN RAISE EXCEPTION 'Trip is not ready for drop verification'; END IF;
  IF b.drop_otp IS NULL OR _otp IS NULL OR b.drop_otp <> regexp_replace(_otp,'\D','','g') THEN RAISE EXCEPTION 'Invalid drop OTP'; END IF;
  UPDATE public.bookings SET drop_verified_at=now(), pod_photo_url=COALESCE(NULLIF(_pod_photo_url,''),pod_photo_url), status='completed'::public.booking_status WHERE id=_booking_id RETURNING * INTO b;
  RETURN b;
END;$function$;

REVOKE ALL ON FUNCTION public.verify_pickup_otp(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verify_pickup_otp(uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.verify_drop_otp(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verify_drop_otp(uuid,text,text) TO authenticated,service_role;

-- Verification timestamps and financial/ownership fields are RPC/server-owned, not client-writable.
REVOKE UPDATE (customer_id,driver_id,fare,distance_km,commission_rate,commission_amount,driver_net_earning,payment_status,payment_method,coupon_code,coupon_discount,coins_redeemed,pickup_address,drop_address,pickup_lat,pickup_lng,drop_lat,drop_lng,service_zone,pickup_verified_at,drop_verified_at) ON public.bookings FROM authenticated;
GRANT UPDATE (status,notes,cancelled_at,cancellation_reason,pod_photo_url,rating,review,loading_started_at,loading_stopped_at,unloading_started_at,unloading_stopped_at) ON public.bookings TO authenticated;

-- Booking lifecycle: OTP is mandatory; POD is never an OTP replacement; driver can cancel only an accepted job.
CREATE OR REPLACE FUNCTION public.enforce_booking_state_machine()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR public.has_role(uid,'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.status IN ('completed'::public.booking_status,'cancelled'::public.booking_status,'expired'::public.booking_status) THEN RAISE EXCEPTION 'Booking is already closed'; END IF;
  IF OLD.status='pending'::public.booking_status AND NEW.status='accepted'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the accepting driver can claim this booking'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='accepted'::public.booking_status AND NEW.status='in_progress'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM uid OR NEW.pickup_verified_at IS NULL THEN RAISE EXCEPTION 'Pickup OTP verification is required'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='in_progress'::public.booking_status AND NEW.status='completed'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM uid OR NEW.drop_verified_at IS NULL THEN RAISE EXCEPTION 'Drop OTP verification is required before completion'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status='cancelled'::public.booking_status THEN
    IF COALESCE(length(trim(NEW.cancellation_reason)),0)=0 THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;
    IF NEW.customer_id=uid AND OLD.status IN ('pending'::public.booking_status,'accepted'::public.booking_status) THEN RETURN NEW; END IF;
    IF NEW.driver_id=uid AND OLD.status='accepted'::public.booking_status THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'This booking cannot be cancelled at its current stage';
  END IF;
  RAISE EXCEPTION 'Invalid booking status transition: % -> %',OLD.status,NEW.status;
END;$function$;
DROP TRIGGER IF EXISTS trg_bookings_state_machine ON public.bookings;
CREATE TRIGGER trg_bookings_state_machine BEFORE UPDATE OF status ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_state_machine();

-- Acceptance timeout support. Expired pending rides disappear from the driver dispatch policy and can be marked expired by a scheduler.
CREATE OR REPLACE FUNCTION public.expire_stale_pending_bookings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE changed integer;
BEGIN
  UPDATE public.bookings SET status='expired'::public.booking_status, cancellation_reason='No driver accepted within dispatch window', cancelled_at=now()
  WHERE status='pending'::public.booking_status AND driver_id IS NULL AND cancelled_at IS NULL AND expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed;
END;$function$;
REVOKE ALL ON FUNCTION public.expire_stale_pending_bookings() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_bookings() TO service_role;

-- Audit log without storing OTPs, signatures or free-form notes.
CREATE TABLE IF NOT EXISTS public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,action text NOT NULL,table_name text NOT NULL,row_id uuid,old_data jsonb,new_data jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_created ON public.audit_logs(table_name,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON public.audit_logs(actor_id,created_at DESC);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'::public.app_role));
REVOKE INSERT,UPDATE,DELETE ON public.audit_logs FROM anon,authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_booking_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
BEGIN
  INSERT INTO public.audit_logs(actor_id,action,table_name,row_id,old_data,new_data) VALUES(auth.uid(),TG_OP,TG_TABLE_NAME,COALESCE(NEW.id,OLD.id),jsonb_build_object('status',OLD.status,'driver_id',OLD.driver_id,'payment_status',OLD.payment_status,'fare',OLD.fare,'commission_amount',OLD.commission_amount,'driver_net_earning',OLD.driver_net_earning),jsonb_build_object('status',NEW.status,'driver_id',NEW.driver_id,'payment_status',NEW.payment_status,'fare',NEW.fare,'commission_amount',NEW.commission_amount,'driver_net_earning',NEW.driver_net_earning)); RETURN COALESCE(NEW,OLD);
END;$function$;
DROP TRIGGER IF EXISTS audit_bookings_financial ON public.bookings;
CREATE TRIGGER audit_bookings_financial AFTER INSERT OR UPDATE OR DELETE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.audit_booking_changes();

CREATE OR REPLACE FUNCTION public.audit_payment_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
BEGIN
  INSERT INTO public.audit_logs(actor_id,action,table_name,row_id,old_data,new_data) VALUES(auth.uid(),TG_OP,TG_TABLE_NAME,COALESCE(NEW.id,OLD.id),jsonb_build_object('state',OLD.state,'amount',OLD.amount,'booking_id',OLD.booking_id,'customer_id',OLD.customer_id),jsonb_build_object('state',NEW.state,'amount',NEW.amount,'booking_id',NEW.booking_id,'customer_id',NEW.customer_id)); RETURN COALESCE(NEW,OLD);
END;$function$;
DROP TRIGGER IF EXISTS audit_payments ON public.payments;
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.audit_payment_changes();
