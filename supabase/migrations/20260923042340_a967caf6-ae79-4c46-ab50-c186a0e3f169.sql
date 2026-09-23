-- 1) Platform settings: one row of shared pricing config. Signed-in users only
-- need the commission rate; the admin who last edited it is no longer exposed.
DROP POLICY IF EXISTS "Settings readable by signed-in users" ON public.platform_settings;
CREATE POLICY "Signed-in users read pricing config" ON public.platform_settings
  FOR SELECT TO authenticated USING (id = true);
REVOKE SELECT ON public.platform_settings FROM authenticated;
GRANT SELECT (id, commission_rate, created_at, updated_at) ON public.platform_settings TO authenticated;

-- 2) Driver incentive tiers are for drivers and staff, not every signed-in account,
-- and only tiers that are currently active.
DROP POLICY IF EXISTS "Anyone authed can read incentive tiers" ON public.driver_incentive_config;
CREATE POLICY "Drivers and admins read active incentive tiers" ON public.driver_incentive_config
  FOR SELECT TO authenticated
  USING (
    (active AND public.has_role(auth.uid(), 'driver'::app_role))
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

-- 3) Vehicle catalogue images are intentionally public product imagery, but two
-- identical read rules existed; keep a single explicit one.
DROP POLICY IF EXISTS "Vehicle photos are publicly readable" ON storage.objects;