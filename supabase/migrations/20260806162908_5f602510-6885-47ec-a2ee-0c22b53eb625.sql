-- Security-definer helper: do two users share a booking? (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.shares_booking_with(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE (b.customer_id = _a AND b.driver_id = _b)
       OR (b.driver_id = _a AND b.customer_id = _b)
  )
$$;

DROP POLICY IF EXISTS "Profiles: read all authenticated" ON public.profiles;

CREATE POLICY "Profiles: read own"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Profiles: read trip counterpart"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() <> id AND public.shares_booking_with(auth.uid(), id));

CREATE POLICY "Profiles: admin read all"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Live updates for the driver's own status changes
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.driver_kyc REPLICA IDENTITY FULL;
ALTER TABLE public.user_roles REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_kyc; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;