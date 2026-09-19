-- 1. Inbound WhatsApp inbox -------------------------------------------------
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_sid text NOT NULL UNIQUE,
  direction text NOT NULL DEFAULT 'inbound',
  from_phone text NOT NULL,
  to_phone text NOT NULL,
  user_id uuid,
  sender_role app_role,
  body text NOT NULL DEFAULT '',
  num_media integer NOT NULL DEFAULT 0,
  latitude double precision,
  longitude double precision,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  intent text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "WhatsApp messages: own or admin"
  ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX whatsapp_messages_pending_idx
  ON public.whatsapp_messages (received_at) WHERE processed_at IS NULL;
CREATE INDEX whatsapp_messages_from_idx ON public.whatsapp_messages (from_phone, received_at DESC);
CREATE TRIGGER whatsapp_messages_touch BEFORE UPDATE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Outbound reply log ------------------------------------------------------
CREATE TABLE public.whatsapp_outbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_phone text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  provider_sid text,
  error text,
  in_reply_to uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.whatsapp_outbound TO authenticated;
GRANT ALL ON public.whatsapp_outbound TO service_role;
ALTER TABLE public.whatsapp_outbound ENABLE ROW LEVEL SECURITY;
CREATE POLICY "WhatsApp replies: admin only"
  ON public.whatsapp_outbound FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER whatsapp_outbound_touch BEFORE UPDATE ON public.whatsapp_outbound
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Booking drafts from WhatsApp -------------------------------------------
CREATE TABLE public.whatsapp_booking_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'collecting',
  pickup_address text,
  pickup_lat double precision,
  pickup_lng double precision,
  drop_address text,
  drop_lat double precision,
  drop_lng double precision,
  scheduled_at timestamptz,
  schedule_text text,
  material text,
  quantity text,
  weight_kg numeric,
  dimensions text,
  vehicle_type text REFERENCES public.vehicle_types(id),
  instructions text,
  distance_km numeric,
  quoted_fare numeric,
  missing_fields text[] NOT NULL DEFAULT '{}',
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_draft_status_check
    CHECK (status IN ('collecting','awaiting_confirmation','confirmed','cancelled','expired','failed'))
);
GRANT SELECT ON public.whatsapp_booking_drafts TO authenticated;
GRANT ALL ON public.whatsapp_booking_drafts TO service_role;
ALTER TABLE public.whatsapp_booking_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "WhatsApp drafts: own or admin"
  ON public.whatsapp_booking_drafts FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX whatsapp_drafts_customer_idx
  ON public.whatsapp_booking_drafts (customer_id, created_at DESC);
CREATE TRIGGER whatsapp_drafts_touch BEFORE UPDATE ON public.whatsapp_booking_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Ops / driver tasks -----------------------------------------------------
CREATE TABLE public.ops_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  title text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'app',
  source_message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_tasks_scope_check CHECK (scope IN ('admin','driver')),
  CONSTRAINT ops_tasks_status_check CHECK (status IN ('open','in_progress','done','cancelled')),
  CONSTRAINT ops_tasks_priority_check CHECK (priority IN ('low','normal','high'))
);
GRANT SELECT ON public.ops_tasks TO authenticated;
GRANT ALL ON public.ops_tasks TO service_role;
ALTER TABLE public.ops_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tasks: assignee or admin can read"
  ON public.ops_tasks FOR SELECT TO authenticated
  USING (assigned_to = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX ops_tasks_assigned_idx ON public.ops_tasks (assigned_to, status, created_at DESC);
CREATE INDEX ops_tasks_scope_idx ON public.ops_tasks (scope, status, created_at DESC);
CREATE TRIGGER ops_tasks_touch BEFORE UPDATE ON public.ops_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Status changes only: never assignment, scope or content.
CREATE OR REPLACE FUNCTION public.ops_task_set_status(_id uuid, _status text)
RETURNS public.ops_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t public.ops_tasks;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _status NOT IN ('open','in_progress','done','cancelled') THEN
    RAISE EXCEPTION 'Unknown status';
  END IF;

  SELECT * INTO t FROM public.ops_tasks WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;

  IF NOT (t.assigned_to = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'You cannot change this task';
  END IF;
  -- Only the ops team may cancel a task.
  IF _status = 'cancelled' AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the ops team can cancel a task';
  END IF;

  UPDATE public.ops_tasks SET
    status = _status,
    completed_at = CASE WHEN _status = 'done' THEN now() ELSE NULL END
  WHERE id = _id
  RETURNING * INTO t;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.ops_task_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_task_set_status(uuid, text) TO authenticated;
