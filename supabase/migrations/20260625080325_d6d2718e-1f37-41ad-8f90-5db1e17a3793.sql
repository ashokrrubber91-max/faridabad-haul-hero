
CREATE TYPE public.sms_event AS ENUM ('accepted','started','completed');
CREATE TYPE public.sms_status AS ENUM ('queued','sent','failed');
CREATE TYPE public.sms_recipient AS ENUM ('customer','driver');

CREATE TABLE public.sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  recipient public.sms_recipient NOT NULL,
  recipient_user_id uuid,
  phone text NOT NULL,
  event public.sms_event NOT NULL,
  body text NOT NULL,
  status public.sms_status NOT NULL DEFAULT 'queued',
  provider_sid text,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sms_logs_booking_idx ON public.sms_logs(booking_id);
CREATE INDEX sms_logs_created_idx ON public.sms_logs(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_logs TO authenticated;
GRANT ALL ON public.sms_logs TO service_role;

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SMS logs: admin read" ON public.sms_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "SMS logs: admin update" ON public.sms_logs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "SMS logs: admin delete" ON public.sms_logs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER sms_logs_touch BEFORE UPDATE ON public.sms_logs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.enqueue_sms_for_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev public.sms_event;
  cust_phone text;
  cust_name text;
  drv_phone text;
  drv_name text;
  ev_label text;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'accepted' THEN ev := 'accepted'; ev_label := 'accepted';
  ELSIF NEW.status = 'in_progress' THEN ev := 'started'; ev_label := 'started (driver en route)';
  ELSIF NEW.status = 'completed' THEN ev := 'completed'; ev_label := 'completed';
  ELSE RETURN NEW;
  END IF;

  SELECT phone, name INTO cust_phone, cust_name FROM public.profiles WHERE id = NEW.customer_id;
  IF NEW.driver_id IS NOT NULL THEN
    SELECT phone, name INTO drv_phone, drv_name FROM public.profiles WHERE id = NEW.driver_id;
  END IF;

  IF cust_phone IS NOT NULL AND cust_phone <> '' THEN
    INSERT INTO public.sms_logs(booking_id, recipient, recipient_user_id, phone, event, body)
    VALUES (
      NEW.id, 'customer', NEW.customer_id, cust_phone, ev,
      'MiniPort: Your booking from ' || NEW.pickup_address || ' has been ' || ev_label || '.'
    );
  END IF;

  IF drv_phone IS NOT NULL AND drv_phone <> '' THEN
    INSERT INTO public.sms_logs(booking_id, recipient, recipient_user_id, phone, event, body)
    VALUES (
      NEW.id, 'driver', NEW.driver_id, drv_phone, ev,
      'MiniPort: Job ' || ev_label || ' \u2014 pickup ' || NEW.pickup_address || ' \u2192 ' || NEW.drop_address || '.'
    );
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER bookings_enqueue_sms
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_sms_for_booking();
