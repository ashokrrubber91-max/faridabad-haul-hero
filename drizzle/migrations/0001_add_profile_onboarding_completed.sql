ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.onboarding_completed IS
  'Whether the account has permanently completed MiniPort onboarding permissions flow.';