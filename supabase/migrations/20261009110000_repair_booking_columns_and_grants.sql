-- Repair booking columns expected by the current MiniPort client and booking triggers.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='cancel_actor') THEN
    CREATE TYPE public.cancel_actor AS ENUM ('customer','driver','admin','system');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='cancellation_category') THEN
    CREATE TYPE public.cancellation_category AS ENUM ('customer_cancelled','driver_cancelled','admin_cancelled','expired');
  END IF;
END $$;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS loading_overtime_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unloading_overtime_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_fare numeric,
  ADD COLUMN IF NOT EXISTS cancelled_by public.cancel_actor,
  ADD COLUMN IF NOT EXISTS cancellation_category public.cancellation_category;

UPDATE public.bookings
   SET cancellation_category = 'expired', cancelled_by = 'system'
 WHERE status = 'expired' AND cancellation_category IS NULL;

UPDATE public.bookings
   SET cancellation_category = 'customer_cancelled', cancelled_by = 'customer'
 WHERE status = 'cancelled' AND cancellation_category IS NULL;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bookings TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bookings' AND policyname='Bookings: customer insert') THEN
    CREATE POLICY "Bookings: customer insert" ON public.bookings FOR INSERT TO authenticated
      WITH CHECK ((SELECT auth.uid()) = customer_id AND (SELECT public.has_role((SELECT auth.uid()), 'customer'::public.app_role)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bookings' AND policyname='Bookings: read by role') THEN
    CREATE POLICY "Bookings: read by role" ON public.bookings FOR SELECT TO authenticated
      USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
        OR customer_id = (SELECT auth.uid())
        OR ((SELECT public.has_role((SELECT auth.uid()), 'driver'::public.app_role))
          AND (((status = 'pending'::public.booking_status) AND (SELECT public.is_kyc_approved((SELECT auth.uid()))))
            OR driver_id = (SELECT auth.uid()))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bookings' AND policyname='Bookings: update by role') THEN
    CREATE POLICY "Bookings: update by role" ON public.bookings FOR UPDATE TO authenticated
      USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
        OR customer_id = (SELECT auth.uid())
        OR ((SELECT public.has_role((SELECT auth.uid()), 'driver'::public.app_role))
          AND (SELECT public.is_kyc_approved((SELECT auth.uid())))
          AND ((status = 'pending'::public.booking_status) OR driver_id = (SELECT auth.uid()))))
      WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
        OR customer_id = (SELECT auth.uid())
        OR ((SELECT public.has_role((SELECT auth.uid()), 'driver'::public.app_role))
          AND (SELECT public.is_kyc_approved((SELECT auth.uid())))
          AND driver_id = (SELECT auth.uid())));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';