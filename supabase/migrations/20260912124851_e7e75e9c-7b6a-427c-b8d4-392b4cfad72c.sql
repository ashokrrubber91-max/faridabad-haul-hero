REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_mark_refunded(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_refunded(uuid) TO authenticated;