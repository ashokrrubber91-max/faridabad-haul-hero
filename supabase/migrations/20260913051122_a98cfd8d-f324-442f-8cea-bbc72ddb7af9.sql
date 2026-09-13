-- The admin "Audit & Security" panel reads booking_otp_attempts, but the table
-- had no SELECT privilege for signed-in users, so the panel failed with a
-- permission error. RLS already restricts rows to admins only
-- (policy "Admins can review OTP attempts"), so granting SELECT does not widen
-- access for customers or drivers.
GRANT SELECT ON public.booking_otp_attempts TO authenticated;