GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

INSERT INTO public.profiles(id, phone, name)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'phone', ''),
  COALESCE(u.raw_user_meta_data->>'name', 'User')
FROM auth.users u
ON CONFLICT (id) DO UPDATE
SET
  phone = CASE WHEN public.profiles.phone IS NULL OR public.profiles.phone = '' THEN EXCLUDED.phone ELSE public.profiles.phone END,
  name = CASE WHEN public.profiles.name IS NULL OR public.profiles.name = '' OR public.profiles.name = 'User' THEN EXCLUDED.name ELSE public.profiles.name END;

INSERT INTO public.user_roles(user_id, role)
SELECT
  u.id,
  CASE
    WHEN u.raw_user_meta_data->>'role' IN ('customer', 'driver', 'admin')
      THEN (u.raw_user_meta_data->>'role')::public.app_role
    ELSE 'customer'::public.app_role
  END
FROM auth.users u
ON CONFLICT DO NOTHING;