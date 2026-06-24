
-- Enums
CREATE TYPE public.app_role AS ENUM ('customer', 'driver', 'admin');
CREATE TYPE public.booking_status AS ENUM ('pending', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.vehicle_type AS ENUM ('tata_ace', 'pickup_8ft', 'tata_407');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles: read all authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Profiles: insert own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Profiles: update own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Roles: read own" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Roles: insert self customer/driver" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND role IN ('customer','driver'));

-- has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Admins can read all roles and profiles
CREATE POLICY "Roles: admin read all" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Bookings
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_address TEXT NOT NULL,
  drop_address TEXT NOT NULL,
  vehicle_type public.vehicle_type NOT NULL,
  distance_km NUMERIC(6,2) NOT NULL,
  fare NUMERIC(10,2) NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Customers see their own
CREATE POLICY "Bookings: customer read own" ON public.bookings FOR SELECT TO authenticated
  USING (auth.uid() = customer_id);
-- Drivers see pending + ones they accepted
CREATE POLICY "Bookings: driver read pending or own" ON public.bookings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'driver') AND (status = 'pending' OR driver_id = auth.uid()));
-- Admins see all
CREATE POLICY "Bookings: admin read all" ON public.bookings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Customers create their own bookings
CREATE POLICY "Bookings: customer insert" ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_id AND public.has_role(auth.uid(),'customer'));

-- Customers can cancel their own pending bookings
CREATE POLICY "Bookings: customer update own" ON public.bookings FOR UPDATE TO authenticated
  USING (auth.uid() = customer_id) WITH CHECK (auth.uid() = customer_id);

-- Drivers can claim a pending booking (set themselves as driver and status) or update their accepted ones
CREATE POLICY "Bookings: driver update" ON public.bookings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'driver') AND (status = 'pending' OR driver_id = auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'driver') AND driver_id = auth.uid());

-- Admins can update anything
CREATE POLICY "Bookings: admin update all" ON public.bookings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER bookings_touch BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile + customer role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles(id, phone, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'name', 'User')
  );
  INSERT INTO public.user_roles(user_id, role)
  VALUES (NEW.id, COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'customer'))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Realtime
ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
