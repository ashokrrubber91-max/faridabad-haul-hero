-- Minimal disposable schema for executing the real dispatch functions offline.
CREATE SCHEMA auth;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TYPE public.app_role AS ENUM ('customer', 'driver', 'admin', 'staff');
CREATE TYPE public.kyc_status AS ENUM ('not_submitted', 'pending', 'approved', 'rejected');
CREATE TYPE public.booking_status AS ENUM ('pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'expired', 'scheduled');
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_online boolean DEFAULT true, kyc_status public.kyc_status DEFAULT 'approved', service_zone text DEFAULT 'Faridabad');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.vehicle_types (id text PRIMARY KEY, active boolean DEFAULT true);
CREATE TABLE public.driver_profiles (user_id uuid PRIMARY KEY, vehicle_type text);
CREATE TABLE public.driver_kyc (driver_id uuid PRIMARY KEY, status public.kyc_status DEFAULT 'approved', vehicle_id text);
CREATE TABLE public.driver_locations (driver_id uuid PRIMARY KEY, latitude double precision, longitude double precision, updated_at timestamptz DEFAULT now());
CREATE TABLE public.wallet_accounts (user_id uuid PRIMARY KEY, cash_balance numeric DEFAULT 100);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY, driver_id uuid, customer_id uuid, status public.booking_status DEFAULT 'pending',
  cancelled_at timestamptz, service_zone text DEFAULT 'Faridabad', vehicle_type text DEFAULT 'tata_ace',
  pickup_lat double precision DEFAULT 28.4, pickup_lng double precision DEFAULT 77.31,
  pickup_address text DEFAULT 'Sector 74', drop_address text DEFAULT 'Ballabgarh',
  fare numeric DEFAULT 500, payment_method text DEFAULT 'cod', payment_status text DEFAULT 'pending',
  expires_at timestamptz DEFAULT now() + interval '15 minutes', created_at timestamptz DEFAULT now(),
  customer_phone text DEFAULT 'private-phone', pickup_otp text DEFAULT '1234', drop_otp text DEFAULT '5678'
);
CREATE TABLE public.driver_booking_passes (booking_id uuid, driver_id uuid, UNIQUE(booking_id,driver_id));
CREATE TABLE public.notifications (user_id uuid, title text, body text, kind text);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
INSERT INTO public.vehicle_types(id) VALUES ('tata_ace'), ('pickup_8ft');
INSERT INTO public.profiles(id) SELECT ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid FROM generate_series(1,4) n;
INSERT INTO public.user_roles SELECT id,'driver' FROM public.profiles;
INSERT INTO public.driver_profiles SELECT id, CASE WHEN id::text LIKE '%000003' THEN 'pickup_8ft' ELSE 'tata_ace' END FROM public.profiles;
INSERT INTO public.driver_kyc SELECT user_id, 'approved', vehicle_type FROM public.driver_profiles;
INSERT INTO public.wallet_accounts SELECT id,100 FROM public.profiles;
INSERT INTO public.driver_locations SELECT id,28.4,77.31,now() FROM public.profiles;