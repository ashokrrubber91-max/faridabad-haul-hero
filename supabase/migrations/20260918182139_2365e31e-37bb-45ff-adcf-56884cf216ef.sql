CREATE TABLE public.phone_verification_attempts (
  phone text PRIMARY KEY,
  sends integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  checks integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.phone_verification_attempts TO service_role;

ALTER TABLE public.phone_verification_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No client access to phone verification attempts"
  ON public.phone_verification_attempts
  FOR SELECT TO authenticated
  USING (false);

CREATE TRIGGER phone_verification_attempts_touch
  BEFORE UPDATE ON public.phone_verification_attempts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();