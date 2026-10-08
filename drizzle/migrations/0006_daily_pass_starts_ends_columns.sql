ALTER TABLE public.driver_daily_passes
  ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ends_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours');

UPDATE public.driver_daily_passes
SET starts_at = COALESCE(purchased_at, starts_at),
    ends_at = COALESCE(expires_at, ends_at);

CREATE OR REPLACE FUNCTION public.driver_daily_passes_sync_times()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.purchased_at := COALESCE(NEW.purchased_at, NEW.starts_at);
  NEW.expires_at := COALESCE(NEW.expires_at, NEW.ends_at);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS driver_daily_passes_sync_times ON public.driver_daily_passes;
CREATE TRIGGER driver_daily_passes_sync_times BEFORE INSERT ON public.driver_daily_passes
FOR EACH ROW EXECUTE FUNCTION public.driver_daily_passes_sync_times();

COMMENT ON COLUMN public.driver_daily_passes.purchased_at IS 'DEPRECATED: replaced by starts_at';
COMMENT ON COLUMN public.driver_daily_passes.expires_at IS 'DEPRECATED: replaced by ends_at';