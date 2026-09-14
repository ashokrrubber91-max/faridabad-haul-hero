-- Social providers may not return a phone number at sign-in time.
-- Keep those accounts valid, but reject malformed non-empty Indian mobile numbers.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_phone_format_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_phone_format_check
  CHECK (phone = '' OR phone ~ '^[6-9][0-9]{9}$') NOT VALID;

COMMENT ON CONSTRAINT profiles_phone_format_check ON public.profiles
  IS 'Non-empty profile phone values must be valid Indian 10-digit mobile numbers.';
