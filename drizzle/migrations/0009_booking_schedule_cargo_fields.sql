ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cargo_weight_kg numeric;
DO $$ BEGIN
  ALTER TABLE public.bookings ADD CONSTRAINT bookings_cargo_weight_kg_range CHECK (cargo_weight_kg IS NULL OR (cargo_weight_kg > 0 AND cargo_weight_kg <= 50000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;