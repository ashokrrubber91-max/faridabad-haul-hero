ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Remove only the broad legacy policies named in the remediation request.
DROP POLICY IF EXISTS "Allow users to view their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow users to insert bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow users to update bookings" ON public.bookings;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.bookings;
DROP POLICY IF EXISTS "Allow authenticated and anon select on bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow authenticated and anon insert on bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow authenticated and anon update on bookings" ON public.bookings;

-- Bookings contain private addresses, contact details, and trip OTPs.
-- Never allow unauthenticated clients to read or mutate booking rows.
REVOKE ALL PRIVILEGES ON TABLE public.bookings FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bookings TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.bookings TO service_role;

-- Preserve the existing owner/role-based authenticated policies.
