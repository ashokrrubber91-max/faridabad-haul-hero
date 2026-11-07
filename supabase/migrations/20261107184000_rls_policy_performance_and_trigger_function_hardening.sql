-- RLS performance cleanup and strict access for pass/issue tables.
-- The policies below preserve each owner's access and the administrator override.

CREATE INDEX IF NOT EXISTS driver_profiles_vehicle_type_idx
  ON public.driver_profiles(vehicle_type);

-- Cache auth.uid() once per statement instead of evaluating it for each row.
DROP POLICY IF EXISTS "Drivers can read their own dispatch offers" ON public.booking_dispatch_offers;
CREATE POLICY "Drivers can read their own dispatch offers"
  ON public.booking_dispatch_offers FOR SELECT TO authenticated
  USING (driver_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "booking participants can read messages" ON public.booking_messages;
CREATE POLICY "booking participants can read messages"
  ON public.booking_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = booking_messages.booking_id
      AND (b.customer_id = (SELECT auth.uid()) OR b.driver_id = (SELECT auth.uid()))
  ));

DROP POLICY IF EXISTS "booking participants can send messages" ON public.booking_messages;
CREATE POLICY "booking participants can send messages"
  ON public.booking_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_messages.booking_id
        AND (b.customer_id = (SELECT auth.uid()) OR b.driver_id = (SELECT auth.uid()))
        AND b.status IN ('accepted'::public.booking_status,'in_progress'::public.booking_status)
    )
  );

-- One SELECT policy for own pass rows plus the admin override. Remove the
-- legacy policy that let every signed-in user read every driver's pass rows.
DROP POLICY IF EXISTS "Admins read all driver passes" ON public.driver_booking_passes;
DROP POLICY IF EXISTS "Authenticated users can view passes" ON public.driver_booking_passes;
DROP POLICY IF EXISTS "Drivers read their own passes" ON public.driver_booking_passes;
CREATE POLICY "Drivers and admins read driver passes"
  ON public.driver_booking_passes FOR SELECT TO authenticated
  USING (
    driver_id = (SELECT auth.uid())
    OR (SELECT public.has_role((SELECT auth.uid()),'admin'::public.app_role))
  );

-- Only a verified driver may mark a booking as passed.
DROP POLICY IF EXISTS "Drivers can insert passes" ON public.driver_booking_passes;
CREATE POLICY "Verified drivers can insert their own passes"
  ON public.driver_booking_passes FOR INSERT TO authenticated
  WITH CHECK (
    driver_id = (SELECT auth.uid())
    AND (SELECT public.has_role((SELECT auth.uid()),'driver'::public.app_role))
    AND (SELECT public.is_kyc_approved((SELECT auth.uid())))
  );

-- The two older driver_daily_passes policies duplicate the strict owner policy.
DROP POLICY IF EXISTS "Drivers can view their own daily passes" ON public.driver_daily_passes;
DROP POLICY IF EXISTS "Drivers read own daily passes" ON public.driver_daily_passes;

-- Remove permissive duplicate trip issue policies. Keep the stricter policies
-- that verify the referenced booking belongs to the reporter and allow admins.
DROP POLICY IF EXISTS "Users can insert trip issues" ON public.trip_issues;
DROP POLICY IF EXISTS "Users can view trip issues" ON public.trip_issues;

-- Profile policies use a statement-level auth.uid() init plan.
DROP POLICY IF EXISTS "Allow users to insert own profile" ON public.profiles;
CREATE POLICY "Allow users to insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS "Allow users to read own profile" ON public.profiles;
CREATE POLICY "Allow users to read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS "Allow users to update own profile" ON public.profiles;
CREATE POLICY "Allow users to update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- Trigger functions are implementation details, not RPC endpoints. PostgreSQL
-- does not need caller EXECUTE grants when firing an already-created trigger.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS function_args
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname='public'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      r.schema_name, r.function_name, r.function_args
    );
  END LOOP;
END;
$$;
