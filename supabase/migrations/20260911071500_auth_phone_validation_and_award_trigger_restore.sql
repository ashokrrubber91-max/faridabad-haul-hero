-- MiniPort auth hardening: reject placeholder/invalid Indian phone numbers at the DB boundary
-- and restore the single canonical booking coin/commission trigger removed by the
-- previous duplicate-trigger cleanup migration.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_phone text;
BEGIN
  normalized_phone := regexp_replace(COALESCE(NEW.raw_user_meta_data->>'phone', ''), '[^0-9]', '', 'g');

  -- Phone/password signup supplies phone metadata. Reject placeholders such as
  -- 0000000000 and malformed/non-Indian mobile numbers before creating the profile.
  -- OAuth users may legitimately have no phone metadata, so those are allowed through.
  IF normalized_phone <> '' AND (
    length(normalized_phone) <> 10
    OR normalized_phone !~ '^[6-9][0-9]{9}$'
    OR normalized_phone ~ '^0+$'
  ) THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number';
  END IF;

  INSERT INTO public.profiles(id, phone, name)
  VALUES (
    NEW.id,
    normalized_phone,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''), 'User')
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

-- The financial-protection migration intentionally used the `zz_` trigger name so
-- this BEFORE trigger runs after the protection trigger. Keep exactly one copy.
DROP TRIGGER IF EXISTS trg_bookings_award_coins ON public.bookings;
DROP TRIGGER IF EXISTS zz_bookings_award_coins ON public.bookings;
CREATE TRIGGER zz_bookings_award_coins
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_award_coins();
