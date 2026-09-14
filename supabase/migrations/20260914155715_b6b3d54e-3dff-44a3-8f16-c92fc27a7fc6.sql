CREATE OR REPLACE FUNCTION public.profiles_validate_phone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  digits text := regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;
  IF length(digits) = 12 AND left(digits, 2) = '91' THEN digits := right(digits, 10); END IF;
  IF length(digits) = 11 AND left(digits, 1) = '0' THEN digits := right(digits, 10); END IF;
  IF digits !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9';
  END IF;
  NEW.phone := digits;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_validate_phone ON public.profiles;
CREATE TRIGGER profiles_validate_phone
BEFORE INSERT OR UPDATE OF phone ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_validate_phone();