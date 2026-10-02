-- Keep the profile update policy simple; trigger above protects privileged fields.
DROP POLICY IF EXISTS "Profiles: update safe own fields" ON public.profiles;
CREATE POLICY "Profiles: update own safe fields"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
