
-- Customer GSTINs
CREATE TABLE public.customer_gstins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gstin text NOT NULL,
  business_name text NOT NULL,
  business_address text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gstin)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_gstins TO authenticated;
GRANT ALL ON public.customer_gstins TO service_role;
ALTER TABLE public.customer_gstins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own gstins" ON public.customer_gstins FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER customer_gstins_touch BEFORE UPDATE ON public.customer_gstins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Driver bank accounts
CREATE TABLE public.driver_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_holder text NOT NULL,
  account_number text NOT NULL,
  ifsc text NOT NULL,
  bank_name text NOT NULL,
  upi_id text,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_bank_accounts TO authenticated;
GRANT ALL ON public.driver_bank_accounts TO service_role;
ALTER TABLE public.driver_bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bank accounts" ON public.driver_bank_accounts FOR ALL TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER driver_bank_accounts_touch BEFORE UPDATE ON public.driver_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Withdrawal requests
CREATE TYPE public.withdrawal_status AS ENUM ('requested', 'paid', 'rejected');
CREATE TABLE public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'bank',
  status public.withdrawal_status NOT NULL DEFAULT 'requested',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.withdrawal_requests TO authenticated;
GRANT ALL ON public.withdrawal_requests TO service_role;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver reads own withdrawals" ON public.withdrawal_requests FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "driver requests withdrawal" ON public.withdrawal_requests FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid() AND status = 'requested'::withdrawal_status);
CREATE POLICY "admin updates withdrawal" ON public.withdrawal_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
GRANT UPDATE ON public.withdrawal_requests TO authenticated;
CREATE TRIGGER withdrawal_requests_touch BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Extra driver documents
ALTER TABLE public.driver_kyc
  ADD COLUMN IF NOT EXISTS insurance_url text,
  ADD COLUMN IF NOT EXISTS puc_url text,
  ADD COLUMN IF NOT EXISTS number_plate_url text,
  ADD COLUMN IF NOT EXISTS vehicle_number text;

-- Trip rating
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS rating smallint CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS review text;
