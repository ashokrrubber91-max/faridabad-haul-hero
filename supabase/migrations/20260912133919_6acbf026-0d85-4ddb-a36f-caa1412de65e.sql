COMMENT ON COLUMN public.customer_profiles.default_gstin_id IS 'DEPRECATED / reserved. Canonical default GSTIN is customer_gstins.is_default, which the app reads and writes. Nothing writes this column; kept instead of dropped to avoid a destructive change.';
COMMENT ON COLUMN public.booking_stops.sequence IS 'Itinerary order: 0 = pickup, 1..3 = intermediate stops, 10 = drop. Unique per booking.';
COMMENT ON COLUMN public.booking_stops.contact_phone IS 'Sender/receiver contact for this stop. Visible only to the trip customer, assigned driver and admins.';
COMMENT ON COLUMN public.driver_profiles.payout_hold IS 'Ops-only flag blocking payouts; driver edits are reverted by driver_profiles_protect().';
COMMENT ON COLUMN public.bookings.notes IS 'Free-text customer instructions. Structured stop data now lives in booking_stops; older rows may still contain a "Stops: ..." prefix for history.';
