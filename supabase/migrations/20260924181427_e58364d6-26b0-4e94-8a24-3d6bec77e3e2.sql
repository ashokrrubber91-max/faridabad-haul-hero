DROP POLICY IF EXISTS "Vehicle catalogue is readable" ON public.vehicle_types;
CREATE POLICY "Active vehicle catalogue is readable" ON public.vehicle_types
FOR SELECT TO anon, authenticated
USING (active OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Vehicle images readable" ON storage.objects;
CREATE POLICY "Vehicle images readable for listed vehicles" ON storage.objects
FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'vehicle-images' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.vehicle_types v WHERE v.active AND v.image_url = storage.objects.name)
  )
);