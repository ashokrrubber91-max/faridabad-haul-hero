-- Corrective hardening migration.
-- The earlier role/trigger hardening migration intentionally removed duplicate trigger names,
-- but later migrations established canonical names for several booking side effects.
-- Restore exactly one canonical trigger for each side effect and remove the client driver-role insert path.

CREATE OR REPLACE FUNCTION public.enforce_user_role_assignment()
RETURNS trigger
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

DROP POLICY IF EXISTS "Roles: insert self customer/driver" ON public.user_roles;
DROP POLICY IF EXISTS "Roles: insert self customer only" ON public.user_roles;
CREATE POLICY "Roles: insert self customer only"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND role = 'customer'::public.app_role);

-- Award/commission: canonical trigger is deliberately prefixed zz_ so it runs after
-- bookings_protect_financials in PostgreSQL trigger-name order.
DROP TRIGGER IF EXISTS trg_bookings_award_coins ON public.bookings;
DROP TRIGGER IF EXISTS bookings_award_coins ON public.bookings;
DROP TRIGGER IF EXISTS zz_bookings_award_coins ON public.bookings;
CREATE TRIGGER zz_bookings_award_coins
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_award_coins();

DROP TRIGGER IF EXISTS trg_bookings_debit_coins ON public.bookings;
DROP TRIGGER IF EXISTS zz_bookings_debit_coins ON public.bookings;
DROP TRIGGER IF EXISTS bookings_debit_coins ON public.bookings;
CREATE TRIGGER bookings_debit_coins
BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_debit_coins();

DROP TRIGGER IF EXISTS trg_bookings_generate_otps ON public.bookings;
DROP TRIGGER IF EXISTS bookings_generate_otps ON public.bookings;
CREATE TRIGGER bookings_generate_otps
BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_generate_otps();

-- The later migration intentionally uses zzz_ so SMS enqueue happens after other updates.
DROP TRIGGER IF EXISTS bookings_enqueue_sms ON public.bookings;
DROP TRIGGER IF EXISTS zzz_bookings_enqueue_sms ON public.bookings;
CREATE TRIGGER zzz_bookings_enqueue_sms
AFTER UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enqueue_sms_for_booking();

DROP TRIGGER IF EXISTS bookings_touch_updated_at ON public.bookings;
DROP TRIGGER IF EXISTS bookings_touch ON public.bookings;
CREATE TRIGGER bookings_touch
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
