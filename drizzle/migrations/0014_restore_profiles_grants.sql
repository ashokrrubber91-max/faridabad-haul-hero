-- Restore Data API access to profiles. Existing RLS (own row / admin read)
-- and the profiles_protect_privileged_fields trigger still govern rows and fields.
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;