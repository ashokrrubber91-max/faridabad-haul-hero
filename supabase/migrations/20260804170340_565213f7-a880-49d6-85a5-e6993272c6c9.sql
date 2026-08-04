-- 1) Server-side recomputation of booking money fields on INSERT
CREATE OR REPLACE FUNCTION public.bookings_enforce_insert_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base numeric;
  per_km numeric;
  gross numeric;
  disc numeric := 0;
  cpn record;
  coin_cap numeric;
  bal numeric;
BEGIN
  -- Privileged/internal contexts and admins may set values explicitly.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Never trust client lifecycle/payment state.
  NEW.status := 'pending'::booking_status;
  NEW.payment_status := 'pending'::payment_status;
  NEW.commission_rate := 0.10;
  NEW.commission_amount := 0;
  NEW.driver_net_earning := 0;
  NEW.driver_id := NULL;
  NEW.pickup_verified_at := NULL;
  NEW.drop_verified_at := NULL;
  NEW.rating := NULL;
  NEW.review := NULL;
  NEW.pod_photo_url := NULL;

  -- Server-side rate card (mirrors the app's published rates).
  SELECT r.base, r.per_km INTO base, per_km FROM (
    VALUES
      ('tata_ace'::vehicle_type, 150::numeric, 22::numeric),
      ('pickup_8ft'::vehicle_type, 220::numeric, 28::numeric),
      ('tata_407'::vehicle_type, 350::numeric, 38::numeric)
  ) AS r(vt, base, per_km) WHERE r.vt = NEW.vehicle_type;

  NEW.distance_km := GREATEST(COALESCE(NEW.distance_km, 0), 0);
  gross := round(base + per_km * NEW.distance_km);

  -- Revalidate the coupon server-side.
  IF NEW.coupon_code IS NOT NULL AND btrim(NEW.coupon_code) <> '' THEN
    SELECT * INTO cpn FROM public.validate_coupon(NEW.coupon_code, gross);
    IF cpn.message = 'ok' THEN
      NEW.coupon_code := cpn.code;
      NEW.coupon_discount := cpn.discount;
    ELSE
      NEW.coupon_code := NULL;
      NEW.coupon_discount := 0;
    END IF;
  ELSE
    NEW.coupon_code := NULL;
    NEW.coupon_discount := 0;
  END IF;

  -- Coins: capped at 50% of gross fare and at the customer's balance.
  SELECT coins_balance INTO bal FROM public.wallet_accounts WHERE user_id = NEW.customer_id;
  coin_cap := LEAST(floor(gross * 0.5), COALESCE(bal, 0));
  NEW.coins_redeemed := GREATEST(LEAST(COALESCE(NEW.coins_redeemed, 0), coin_cap), 0);

  disc := NEW.coupon_discount + NEW.coins_redeemed;
  NEW.fare := GREATEST(gross - disc, 0);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a_bookings_enforce_insert_financials ON public.bookings;
CREATE TRIGGER a_bookings_enforce_insert_financials
BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_enforce_insert_financials();

-- 2) Driver KYC: split the blanket policy so review columns are admin-only.
DROP POLICY IF EXISTS "Drivers manage own kyc" ON public.driver_kyc;

CREATE POLICY "KYC: read own or admin"
ON public.driver_kyc FOR SELECT TO authenticated
USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "KYC: driver submits own"
ON public.driver_kyc FOR INSERT TO authenticated
WITH CHECK (driver_id = auth.uid() AND status = 'pending'::kyc_status
            AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL);

CREATE POLICY "KYC: driver updates own documents"
ON public.driver_kyc FOR UPDATE TO authenticated
USING (driver_id = auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (driver_id = auth.uid());

CREATE POLICY "KYC: admin manages all"
ON public.driver_kyc FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));