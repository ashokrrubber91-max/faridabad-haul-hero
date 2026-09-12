CREATE OR REPLACE FUNCTION private.kyc_review_snapshot(_driver_id uuid)
 RETURNS TABLE(status public.kyc_status, reviewed_by uuid, reviewed_at timestamptz, rejection_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT k.status, k.reviewed_by, k.reviewed_at, k.rejection_reason
  FROM public.driver_kyc k WHERE k.driver_id = _driver_id
$function$;
REVOKE ALL ON FUNCTION private.kyc_review_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.kyc_review_snapshot(uuid) TO authenticated;

DROP POLICY IF EXISTS "KYC: driver updates own documents" ON public.driver_kyc;
CREATE POLICY "KYC: driver updates own documents" ON public.driver_kyc
FOR UPDATE TO authenticated
USING (driver_id = auth.uid())
WITH CHECK (
  driver_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM private.kyc_review_snapshot(driver_kyc.driver_id) s
     WHERE driver_kyc.status IS NOT DISTINCT FROM s.status
       AND driver_kyc.reviewed_by IS NOT DISTINCT FROM s.reviewed_by
       AND driver_kyc.reviewed_at IS NOT DISTINCT FROM s.reviewed_at
       AND driver_kyc.rejection_reason IS NOT DISTINCT FROM s.rejection_reason
  )
);