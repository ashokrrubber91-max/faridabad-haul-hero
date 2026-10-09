-- Driver order acceptance/admin operations completion
-- Adds resolvable trip issues and enables Realtime for issue/pass monitoring.

ALTER TABLE public.trip_issues
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE INDEX IF NOT EXISTS trip_issues_status_idx
  ON public.trip_issues (resolved_at, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_resolve_trip_issue(
  _issue_id uuid,
  _resolution_note text
)
RETURNS public.trip_issues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _issue public.trip_issues;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only the operations team can resolve trip issues';
  END IF;

  IF length(coalesce(btrim(_resolution_note), '')) < 2 THEN
    RAISE EXCEPTION 'Add a resolution note';
  END IF;

  SELECT * INTO _issue
  FROM public.trip_issues
  WHERE id = _issue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip issue not found';
  END IF;

  IF _issue.resolved_at IS NOT NULL THEN
    RETURN _issue;
  END IF;

  UPDATE public.trip_issues
  SET resolved_at = now(),
      resolved_by = auth.uid(),
      resolution_note = left(btrim(_resolution_note), 500)
  WHERE id = _issue_id
  RETURNING * INTO _issue;

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (
    auth.uid(),
    'admin_resolve_trip_issue',
    'trip_issues',
    _issue_id,
    jsonb_build_object('resolution_note', left(btrim(_resolution_note), 500))
  );

  RETURN _issue;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_trip_issue(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_trip_issue(uuid, text) TO authenticated;

ALTER TABLE public.trip_issues REPLICA IDENTITY FULL;
ALTER TABLE public.driver_booking_passes REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_issues;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_booking_passes;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;