
CREATE TYPE public.address_kind AS ENUM ('home', 'shop', 'other');

CREATE TABLE public.saved_addresses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.address_kind NOT NULL DEFAULT 'other',
  alias TEXT,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  place_id TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_addresses TO authenticated;
GRANT ALL ON public.saved_addresses TO service_role;

ALTER TABLE public.saved_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_saved_addresses_select" ON public.saved_addresses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own_saved_addresses_insert" ON public.saved_addresses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_saved_addresses_update" ON public.saved_addresses
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_saved_addresses_delete" ON public.saved_addresses
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER saved_addresses_touch
  BEFORE UPDATE ON public.saved_addresses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX saved_addresses_user_idx ON public.saved_addresses(user_id, created_at DESC);
