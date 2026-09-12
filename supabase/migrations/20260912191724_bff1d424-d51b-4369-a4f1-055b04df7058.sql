DROP POLICY IF EXISTS "Vehicle images readable" ON storage.objects;
CREATE POLICY "Vehicle images readable" ON storage.objects FOR SELECT USING (bucket_id = 'vehicle-images');

DROP POLICY IF EXISTS "Admins upload vehicle images" ON storage.objects;
CREATE POLICY "Admins upload vehicle images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'vehicle-images' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins update vehicle images" ON storage.objects;
CREATE POLICY "Admins update vehicle images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'vehicle-images' AND public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (bucket_id = 'vehicle-images' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins delete vehicle images" ON storage.objects;
CREATE POLICY "Admins delete vehicle images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'vehicle-images' AND public.has_role(auth.uid(), 'admin'::app_role));