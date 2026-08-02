CREATE POLICY "POD: driver uploads own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'delivery-proof'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "POD: driver reads own folder"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'delivery-proof'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.customer_id = auth.uid()
        AND b.pod_photo_url IS NOT NULL
        AND b.pod_photo_url = storage.objects.name
    )
  )
);