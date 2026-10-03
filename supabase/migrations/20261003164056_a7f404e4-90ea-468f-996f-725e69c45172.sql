CREATE OR REPLACE FUNCTION public.ensure_my_referral_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _code text; _cand text; _chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT referral_code INTO _code FROM public.profiles WHERE id = _uid;
  IF _code IS NOT NULL AND btrim(_code) <> '' THEN RETURN _code; END IF;
  LOOP
    _cand := 'MINI';
    FOR i IN 1..4 LOOP _cand := _cand || substr(_chars, 1 + floor(random()*length(_chars))::int, 1); END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = _cand);
  END LOOP;
  UPDATE public.profiles SET referral_code = _cand WHERE id = _uid AND (referral_code IS NULL OR btrim(referral_code) = '');
  SELECT referral_code INTO _code FROM public.profiles WHERE id = _uid;
  RETURN _code;
END $$;
REVOKE ALL ON FUNCTION public.ensure_my_referral_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_referral_code() TO authenticated;