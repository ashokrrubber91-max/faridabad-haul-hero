-- MiniPort production hardening: role assignment, duplicate triggers, and booking indexes.
-- New accounts are always created as customers by the auth trigger. Driver/admin roles
-- can only be granted by an admin/service-role workflow.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles(id, phone, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'name', 'User')
  )
  ON CONFLICT (id) DO NOTHING;

  -- Never trust client-controlled role metadata. Every new account starts as customer.
  INSERT INTO public.user_roles(user_id, role)
  VALUES (NEW.id, 'customer'::public.app_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- Defense in depth: even if an authenticated client can INSERT into user_roles,
-- it cannot self-assign driver/admin. Existing admins and service-role operations can.
CREATE OR REPLACE FUNCTION public.enforce_user_role_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'customer'::public.app_role THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only an administrator can assign privileged roles';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_role_assignment ON public.user_roles;
CREATE TRIGGER trg_enforce_user_role_assignment
BEFORE INSERT OR UPDATE OF role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_user_role_assignment();

REVOKE EXECUTE ON FUNCTION public.enforce_user_role_assignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_user_role_assignment() TO service_role;

-- Remove duplicate side-effect triggers currently present on bookings.
DROP TRIGGER IF EXISTS trg_bookings_award_coins ON public.bookings;
DROP TRIGGER IF EXISTS zz_bookings_award_coins ON public.bookings;
DROP TRIGGER IF EXISTS trg_bookings_debit_coins ON public.bookings;
DROP TRIGGER IF EXISTS trg_bookings_generate_otps ON public.bookings;
DROP TRIGGER IF EXISTS zzz_bookings_enqueue_sms ON public.bookings;
DROP TRIGGER IF EXISTS bookings_touch_updated_at ON public.bookings;

-- Keep exactly one trigger for each logical side effect.
-- Existing canonical triggers retained:
-- bookings_award_coins, bookings_debit_coins, bookings_generate_otps,
-- bookings_enqueue_sms, bookings_touch.

-- Operational indexes for the most frequent booking lookups.
CREATE INDEX IF NOT EXISTS idx_bookings_customer_created
  ON public.bookings(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_driver_updated
  ON public.bookings(driver_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_status_zone_created
  ON public.bookings(status, service_zone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_status_driver_cancelled
  ON public.bookings(status, driver_id, cancelled_at);

-- Fast path for open dispatch requests.
CREATE INDEX IF NOT EXISTS idx_bookings_pending_zone_created
  ON public.bookings(service_zone, created_at DESC)
  WHERE status = 'pending'::public.booking_status AND driver_id IS NULL AND cancelled_at IS NULL;
