CREATE OR REPLACE FUNCTION public.audit_sensitive_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _raw text;
  _row_id uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    _raw := to_jsonb(NEW)->>'id';
    IF _raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      _row_id := _raw::uuid;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, table_name, row_id, old_data, new_data)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, _row_id,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END;
$function$;