-- Reading trips was accidentally revoked when column-level write hardening was
-- applied to public.bookings. Row-level rules still decide which trips each
-- signed-in account can see; writes stay limited to the safe columns.
GRANT SELECT ON public.bookings TO authenticated;