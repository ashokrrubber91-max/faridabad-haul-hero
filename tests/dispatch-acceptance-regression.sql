-- This same test fails on the reported nearest-first accept_booking and passes on the repair.
BEGIN;
INSERT INTO public.bookings(id) VALUES ('10000000-0000-0000-0000-000000000001');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.accept_booking('10000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Regression: an unoffered nearby driver accepted the ride'; END IF;
END $$;
ROLLBACK;