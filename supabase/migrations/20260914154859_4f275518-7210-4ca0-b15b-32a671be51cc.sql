-- 1) additive columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancel_actor') THEN
    CREATE TYPE public.cancel_actor AS ENUM ('customer','driver','admin','system');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancellation_category') THEN
    CREATE TYPE public.cancellation_category AS ENUM ('customer_cancelled','driver_cancelled','admin_cancelled','expired');
  END IF;
END $$;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_by public.cancel_actor,
  ADD COLUMN IF NOT EXISTS cancellation_category public.cancellation_category;

-- 2) backfill existing rows conservatively
UPDATE public.bookings
   SET cancellation_category = 'expired', cancelled_by = 'system'
 WHERE status = 'expired' AND cancellation_category IS NULL;

UPDATE public.bookings b
   SET cancellation_category = 'admin_cancelled', cancelled_by = 'admin'
 WHERE b.status = 'cancelled'
   AND b.cancellation_category IS NULL
   AND EXISTS (
     SELECT 1 FROM public.audit_logs a
      WHERE a.row_id = b.id AND a.action = 'admin_cancel_booking'
   );

UPDATE public.bookings
   SET cancellation_category = 'customer_cancelled', cancelled_by = 'customer'
 WHERE status = 'cancelled' AND cancellation_category IS NULL;

-- 3) protect the new fields from untrusted writes
CREATE OR REPLACE FUNCTION public.bookings_protect_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); trusted boolean := public.is_trusted_booking_write();
BEGIN
  IF uid IS NULL OR public.has_role(uid, 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NOT trusted THEN
    NEW.fare := OLD.fare;
    NEW.loading_overtime_minutes := OLD.loading_overtime_minutes;
    NEW.unloading_overtime_minutes := OLD.unloading_overtime_minutes;
    NEW.overtime_charge := OLD.overtime_charge;
    NEW.final_fare := OLD.final_fare;
    NEW.loading_started_at := OLD.loading_started_at;
    NEW.loading_stopped_at := OLD.loading_stopped_at;
    NEW.unloading_started_at := OLD.unloading_started_at;
    NEW.unloading_stopped_at := OLD.unloading_stopped_at;
    NEW.pickup_verified_at := OLD.pickup_verified_at;
    NEW.drop_verified_at := OLD.drop_verified_at;
    NEW.pod_photo_url := OLD.pod_photo_url;
    NEW.service_zone := OLD.service_zone;
    NEW.expires_at := OLD.expires_at;
    NEW.cancelled_by := OLD.cancelled_by;
    NEW.cancellation_category := OLD.cancellation_category;
  END IF;

  NEW.coupon_code := OLD.coupon_code;
  NEW.coupon_discount := OLD.coupon_discount;
  NEW.coins_redeemed := OLD.coins_redeemed;
  NEW.commission_rate := OLD.commission_rate;
  NEW.payment_method := OLD.payment_method;
  NEW.distance_km := OLD.distance_km;
  NEW.customer_id := OLD.customer_id;
  NEW.vehicle_type := OLD.vehicle_type;

  IF NOT trusted THEN
    NEW.commission_amount := OLD.commission_amount;
    NEW.driver_net_earning := OLD.driver_net_earning;
    NEW.payment_status := OLD.payment_status;
  END IF;

  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     AND NOT trusted
     AND NOT (
       OLD.driver_id IS NULL
       AND NEW.driver_id = uid
       AND public.has_role(uid, 'driver'::app_role)
     )
  THEN
    NEW.driver_id := OLD.driver_id;
  END IF;

  RETURN NEW;
END $function$;

-- 4) cancel_booking records the actor + category
CREATE OR REPLACE FUNCTION public.cancel_booking(_booking_id uuid, _reason text, _note text DEFAULT NULL::text)
RETURNS bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b public.bookings;
  uid uuid := auth.uid();
  clean_reason text;
  next_notes text;
  actor public.cancel_actor;
  category public.cancellation_category;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  clean_reason := left(btrim(COALESCE(_reason, '')), 300);
  IF length(clean_reason) < 3 THEN RAISE EXCEPTION 'Add a cancellation reason'; END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    RAISE EXCEPTION 'Trip is already closed';
  END IF;

  IF b.customer_id = uid THEN
    IF b.status NOT IN ('pending'::public.booking_status, 'accepted'::public.booking_status, 'in_progress'::public.booking_status) THEN
      RAISE EXCEPTION 'This trip can no longer be cancelled';
    END IF;
    actor := 'customer'; category := 'customer_cancelled';
  ELSIF b.driver_id = uid THEN
    IF b.status <> 'accepted'::public.booking_status THEN
      RAISE EXCEPTION 'You can only drop a trip before pickup verification';
    END IF;
    actor := 'driver'; category := 'driver_cancelled';
  ELSE
    RAISE EXCEPTION 'Only the customer or assigned driver can cancel this trip';
  END IF;

  next_notes := CASE
    WHEN _note IS NULL OR btrim(_note) = '' THEN b.notes
    WHEN b.notes IS NULL OR btrim(b.notes) = '' THEN left(btrim(_note), 500)
    ELSE left(b.notes || ' · ' || btrim(_note), 1000)
  END;

  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings
     SET status = 'cancelled'::public.booking_status,
         cancelled_at = now(),
         cancellation_reason = clean_reason,
         cancelled_by = actor,
         cancellation_category = category,
         notes = next_notes
   WHERE id = _booking_id
  RETURNING * INTO b;
  PERFORM set_config('miniport.trusted_write', 'off', true);

  RETURN b;
END $function$;

-- 5) admin cancel records admin attribution
CREATE OR REPLACE FUNCTION public.admin_cancel_booking(_booking_id uuid, _reason text)
RETURNS bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _b public.bookings;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only the operations team can cancel trips';
  END IF;
  IF length(coalesce(btrim(_reason), '')) < 4 THEN
    RAISE EXCEPTION 'Add a cancellation reason';
  END IF;

  SELECT * INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;
  IF _b.status IN ('completed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'Trip is already closed';
  END IF;

  UPDATE public.bookings
     SET status = 'cancelled',
         cancellation_reason = left(btrim(_reason), 300),
         cancelled_at = now(),
         cancelled_by = 'admin'::public.cancel_actor,
         cancellation_category = 'admin_cancelled'::public.cancellation_category,
         updated_at = now()
   WHERE id = _booking_id
  RETURNING * INTO _b;

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_cancel_booking', 'bookings', _booking_id,
          jsonb_build_object('reason', btrim(_reason)));

  RETURN _b;
END;
$function$;

-- 6) expiry records system attribution
CREATE OR REPLACE FUNCTION public.expire_stale_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE public.bookings
     SET status = 'expired'::booking_status,
         cancelled_by = 'system'::public.cancel_actor,
         cancellation_category = 'expired'::public.cancellation_category,
         updated_at = now()
   WHERE status = 'pending'
     AND driver_id IS NULL
     AND cancelled_at IS NULL
     AND expires_at IS NOT NULL
     AND expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;