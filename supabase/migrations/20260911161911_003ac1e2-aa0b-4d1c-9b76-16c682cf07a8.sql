-- 1. Remove the duplicate KYC status-sync trigger (two identical triggers ran per row)
DROP TRIGGER IF EXISTS zz_driver_kyc_sync_profile ON public.driver_kyc;

-- 2. Column-level privileges on bookings: never expose OTP columns to app users.
REVOKE SELECT ON public.bookings FROM authenticated;
REVOKE SELECT ON public.bookings FROM anon;
GRANT SELECT (
  id, customer_id, driver_id, pickup_address, drop_address, vehicle_type, distance_km, fare,
  status, notes, created_at, updated_at, coupon_code, coupon_discount, coins_redeemed,
  payment_method, payment_status, commission_rate, commission_amount, driver_net_earning,
  pickup_verified_at, drop_verified_at, rating, review, pod_photo_url, cancellation_reason,
  pickup_lat, pickup_lng, drop_lat, drop_lng, loading_started_at, loading_stopped_at,
  unloading_started_at, unloading_stopped_at, service_zone, cancelled_at, expires_at
) ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;