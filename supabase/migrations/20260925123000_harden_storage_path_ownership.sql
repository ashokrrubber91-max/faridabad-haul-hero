-- Harden Storage path ownership for POD uploads and account deletion.
-- The UI already stores POD/KYC objects under <user-id>/..., so this preserves
-- existing behavior while preventing cross-user object references.

CREATE OR REPLACE FUNCTION public.attach_delivery_photo(_booking_id uuid, _pod_path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b public.bookings;
  uid uuid := auth.uid();
  own_prefix text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  own_prefix := uid::text || '/';

  IF _pod_path IS NULL OR btrim(_pod_path) = '' OR length(_pod_path) > 400 THEN
    RAISE EXCEPTION 'Invalid photo reference';
  END IF;

  IF left(btrim(_pod_path), length(own_prefix)) <> own_prefix
     OR position('..' in btrim(_pod_path)) > 0 THEN
    RAISE EXCEPTION 'Invalid delivery photo ownership';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.driver_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Only the assigned driver can add a delivery photo';
  END IF;
  IF b.status NOT IN ('in_progress'::public.booking_status, 'completed'::public.booking_status) THEN
    RAISE EXCEPTION 'Delivery photos can only be added on an ongoing or completed trip';
  END IF;

  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings SET pod_photo_url = btrim(_pod_path) WHERE id = _booking_id;
  PERFORM set_config('miniport.trusted_write', 'off', true);
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  open_count int;
  had bool;
  paths text[] := '{}';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT count(*) INTO open_count FROM public.bookings
   WHERE (customer_id = uid OR driver_id = uid)
     AND status IN ('pending', 'accepted', 'in_progress');
  IF open_count > 0 THEN
    RAISE EXCEPTION 'You still have an ongoing trip. Please finish or cancel it before deleting your account.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.bookings WHERE customer_id = uid OR driver_id = uid) INTO had;

  SELECT coalesce(array_agg(p) FILTER (WHERE p IS NOT NULL AND p LIKE uid::text || '/%'), '{}')
    INTO paths
  FROM (
    SELECT unnest(ARRAY[
      dl_front_url, dl_back_url, rc_url, id_proof_url, vehicle_photo_url,
      insurance_url, puc_url, number_plate_url, driver_photo_url, poc_photo_url
    ]) AS p
    FROM public.driver_kyc WHERE driver_id = uid
  ) s;

  DELETE FROM public.saved_addresses WHERE user_id = uid;
  DELETE FROM public.customer_gstins WHERE user_id = uid;
  DELETE FROM public.device_tokens WHERE user_id = uid;
  DELETE FROM public.driver_bank_accounts WHERE driver_id = uid;
  DELETE FROM public.driver_locations WHERE driver_id = uid;
  DELETE FROM public.notifications WHERE user_id = uid;
  DELETE FROM public.driver_kyc WHERE driver_id = uid;
  DELETE FROM public.customer_profiles WHERE user_id = uid;
  DELETE FROM public.driver_profiles WHERE user_id = uid;
  UPDATE public.booking_share_links SET revoked_at = now()
    WHERE created_by = uid AND revoked_at IS NULL;
  UPDATE public.profiles SET name = 'Deleted user', phone = '0000000000' WHERE id = uid;

  INSERT INTO public.account_deletions (user_id, had_bookings) VALUES (uid, had);

  RETURN jsonb_build_object('storage_paths', to_jsonb(paths), 'had_bookings', had);
END $function$;