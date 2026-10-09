CREATE OR REPLACE FUNCTION public.process_scheduled_booking_automation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  reminder_count integer := 0;
  assigned_driver_reminder_count integer := 0;
  dispatch_count integer := 0;
  dispatch_notification_count integer := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.booking_id, s.customer_id, b.driver_id, s.scheduled_for,
           b.pickup_address, b.drop_address
    FROM public.scheduled_booking_reminders s
    JOIN public.bookings b ON b.id = s.booking_id
    WHERE s.status = 'queued'
      AND s.reminder_at <= now()
      AND b.status = 'scheduled'
      AND b.payment_status = 'paid'
      AND b.scheduled_for > now()
    ORDER BY s.reminder_at
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      r.customer_id,
      'Upcoming scheduled trip — 24-hour reminder',
      'Your MiniPort pickup is scheduled for ' ||
        to_char(r.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') ||
        '. Your trip will be sent to nearby drivers 30 minutes before pickup.',
      'scheduled_reminder'
    );

    IF r.driver_id IS NOT NULL AND r.driver_id <> r.customer_id THEN
      INSERT INTO public.notifications (user_id, title, body, kind)
      VALUES (
        r.driver_id,
        'Assigned scheduled trip — 24-hour reminder',
        'You are assigned to a MiniPort pickup scheduled for ' ||
          to_char(r.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') ||
          '. Pickup: ' || r.pickup_address || '. Drop: ' || r.drop_address ||
          '. Please keep your availability updated.',
        'scheduled_reminder'
      );
      assigned_driver_reminder_count := assigned_driver_reminder_count + 1;
    END IF;

    UPDATE public.scheduled_booking_reminders
       SET status = 'sent', sent_at = now(), updated_at = now()
     WHERE id = r.id AND status = 'queued';
    reminder_count := reminder_count + 1;
  END LOOP;

  WITH dispatched AS (
    UPDATE public.bookings b
       SET status = 'pending', updated_at = now()
     WHERE b.status = 'scheduled'
       AND b.scheduled_for IS NOT NULL
       AND b.scheduled_for > now()
       AND b.scheduled_for <= now() + interval '30 minutes'
       AND b.payment_status = 'paid'
    RETURNING b.id, b.pickup_address, b.drop_address, b.vehicle_type,
              b.cargo_weight_kg, b.fare, b.scheduled_for, b.service_zone
  ),
  notified AS (
    INSERT INTO public.notifications (user_id, title, body, kind)
    SELECT p.id,
           'Scheduled MiniPort trip available',
           'A paid scheduled trip is ready for driver matching. Pickup: ' ||
             d.pickup_address || ' → Drop: ' || d.drop_address ||
             '. Vehicle: ' || d.vehicle_type ||
             CASE WHEN d.cargo_weight_kg IS NOT NULL
               THEN '. Cargo: ' || d.cargo_weight_kg::text || ' kg'
               ELSE ''
             END ||
             '. Fare: ₹' || round(d.fare)::text ||
             '. Pickup time: ' || to_char(d.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'),
           'scheduled_dispatch'
    FROM dispatched d
    JOIN public.profiles p
      ON p.is_online = true
     AND p.kyc_status::text = 'approved'
     AND (p.service_zone IS NULL OR p.service_zone = d.service_zone)
    WHERE EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role::text = 'driver'
    )
    RETURNING id
  )
  SELECT (SELECT count(*) FROM dispatched),
         (SELECT count(*) FROM notified)
    INTO dispatch_count, dispatch_notification_count;

  UPDATE public.scheduled_booking_reminders s
     SET status = 'cancelled', updated_at = now()
    FROM public.bookings b
   WHERE s.booking_id = b.id
     AND s.status = 'queued'
     AND (b.status <> 'scheduled' OR b.scheduled_for <= now());

  RETURN jsonb_build_object(
    'reminders_sent', reminder_count,
    'assigned_driver_reminders_sent', assigned_driver_reminder_count,
    'bookings_dispatched', dispatch_count,
    'dispatch_notifications_sent', dispatch_notification_count
  );
END;
$function$;