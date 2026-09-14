# MiniPort upgrade plan — profiles, cancellations, location, trip sharing, vehicle specs

Audit of the current app first, then a batch-by-batch build order. No code changed yet.

## A. What I found (root causes)

1. **No sign-out for admin or driver home.** Sign-out exists only inside the Account page (`account.tsx`). The admin console and driver home have no logout control at all.
2. **Account page is customer-shaped.** GST numbers, saved addresses and monthly invoices render for anyone whose active mode isn't driver — including admins. There is no admin-specific profile section. Driver fields live in a separate card (vehicle number + 4 document photos) but are missing driver photo, POC/owner contact, driving-licence/RC visibility and a plain verification-status summary.
3. **Cancellation reason is stored but barely surfaced.** The booking record keeps `cancellation_reason` and `cancelled_at`; the admin bookings list shows the reason, but customer "My rides" and driver history show only the status word. Nothing distinguishes "customer cancelled", "driver cancelled", "expired" or "payment failed" — a failed payment currently looks like an ordinary dead booking.
4. **Coordinate-only addresses.** When Google reverse geocoding fails or the map key is rejected, the picker stores `"28.40123, 77.31245"` as the address itself. That string then becomes the pickup/drop label everywhere — driver job card, admin, invoice. The driver card also shows only the address line with no coordinates/landmark separation.
5. **Location permission is requested from inside an open overlay.** "Use my location" fires while the search sheet/dialog is mounted, which is what produces the "this site can't ask for your permission / close bubbles" state on Android. There is no permission-state check before asking, no re-ask path, and the only fallback is typing an address.
6. **Review Booking has an extra confirmation gate.** The goods-restriction checklist must be opened and confirmed before the Book button enables — that is the duplicate "verify to confirm" step.
7. **Review Booking cannot edit the map.** "Edit location" only jumps back to the form; there is no direct map-pin re-adjust from review.
8. **Vehicle specs are incomplete.** The catalogue has capacity label, weight limit and a free-text load area, but no structured length/width/height, so specs can't be shown consistently before booking and bike delivery has nothing meaningful to show.
9. **Signup accepts loose phone numbers.** Validation is `>= 10 digits` and the number is truncated to the last 10, so 11–15 digit and non-Indian-format numbers pass. There is no OTP verification before account creation (OTP sign-in exists but needs an SMS provider).
10. **Role conversion is a link, not a flow.** "Become a MiniPort driver" jumps straight to KYC; there's no explicit customer→driver conversion state with clear "not yet approved" messaging in one place.
11. **Trip sharing and 112 already exist** (`TripSafetyActions`) but the share link points at `/customer?trip=…`, a protected route — the recipient sees a login page. There is no public share view, no pickup-area photo, and driver-approach ETA/distance is not consolidated into one clear card.

## B. Files and tables to change

- Auth/Admin: `src/routes/auth.tsx`, `src/routes/admin.tsx`, `src/routes/_authenticated/account.tsx`, new `src/components/admin/AdminAccountProfile.tsx`, new `src/components/nav/AccountMenu.tsx`
- Customer: `src/routes/_authenticated/customer.tsx`, `orders.tsx`, `src/components/booking/ReviewBooking.tsx`, `LocationSearchOverlay.tsx`, `MapPinConfirm.tsx`, `VehicleCard.tsx`, `TripDetailDialog.tsx`, `LiveTripMap.tsx`, new `DriverApproachCard.tsx`, new `PickupPhoto.tsx`
- Driver: `src/routes/_authenticated/driver.tsx`, `driver-rides.tsx`, `driver-kyc.tsx`, `src/components/driver/DriverAccountProfile.tsx`, `IncomingRideOverlay.tsx`
- Shared: `src/lib/booking.ts`, `src/lib/vehicles.ts`, `src/lib/cancellation.ts`, new `src/lib/geolocation.ts`, new `src/lib/share-trip.ts`, new public route `src/routes/trip.$token.tsx` + `src/lib/share.functions.ts`
- Tables: `bookings`, `vehicle_types`, `driver_kyc`, `profiles`, new `booking_share_links`, new `payment_attempts` view/read path over existing `payments`

## C. Database and state changes (additive, forward-only)

1. `bookings`: add `cancelled_by` (`customer|driver|admin|system`), `cancellation_category` (`customer_cancelled|driver_cancelled|expired|payment_failed|admin_cancelled`). Backfill from existing `cancelled_at`/reason. Writable only through the existing cancel RPCs; `bookings_protect_financials` extended to cover them.
2. `vehicle_types`: add `length_ft`, `width_ft`, `height_ft`, `payload_kg`, `spec_notes`, all nullable, editable through `admin_upsert_vehicle_type` only. Seeded from the operator's real numbers — no invented legal limits.
3. `driver_kyc`: add `driver_photo_url`, `poc_name`, `poc_phone`, `poc_photo_url`, updatable through the existing `driver_update_account_profile` RPC (document change still resets review to pending).
4. New `booking_share_links(id, booking_id, token unique, created_by, expires_at, revoked_at)` with RLS: owner (customer or assigned driver) may create/revoke; nobody may read directly. A public server function resolves a token to a safe payload only (status, pickup/drop text, distance, ETA, vehicle label, driver first name + vehicle number, no phone numbers, no OTPs, no fare breakdown beyond total).
5. Payment attempts: read the existing `payments` rows as an attempt history on the trip detail screen. Cancellation stays separate from `payment_status='failed'`; the switch-to-cash RPC already keeps the booking active.

## D. Implementation order (safe batches)

**Batch 1 — Profiles and logout.** Sign-out in admin header and driver header; role-correct Account page (admin section: role, zone, commission/config shortcuts, audit access, no GST/addresses; driver section: vehicle number + type, driver photo, POC, insurance/PUC/plate/DL/RC, verification status; customer section unchanged).

**Batch 2 — Cancellation and payment-failure semantics.** Migration for `cancelled_by`/`cancellation_category`; cancel RPCs record them; reason + who cancelled shown in customer rides, driver history and admin; failed payment shows "Payment failed — retry or pay cash", never "Cancelled"; payment attempt history on trip detail.

**Batch 3 — Location reliability.** New geolocation helper: check `navigator.permissions` first, only ask from a direct button tap with all overlays closed, distinct copy for denied/blocked/unavailable/insecure-origin, retry, and a "drop pin on map" + "type address" fallback. Reverse-geocode failure no longer produces a coordinate-only address — the pin step demands a typed/label address and coordinates are stored separately.

**Batch 4 — Booking flow and review screen.** Remove the goods-checklist gate from confirm (keep the checklist as informational content); add map Edit for pickup and drop directly on review; show vehicle specs on review.

**Batch 5 — Vehicle specs.** Migration + admin form fields + specs shown on vehicle cards, a compare/detail sheet, and review booking.

**Batch 6 — Driver job clarity.** Formatted address as the primary line, coordinates as small secondary text, landmark/contact, navigation as a separate button.

**Batch 7 — Driver approach and pickup imagery.** Consolidated approach card (status, ETA, remaining distance, driver + vehicle, refreshed from real driver GPS only) and pickup-area photo from Google Static/Street View when the key allows, otherwise a clean map/placeholder tile.

**Batch 8 — Share trip and safety.** Share-link table + public `/trip/$token` view; native share + WhatsApp; keep 112 prominent during active trips.

**Batch 9 — Signup validation and role conversion.** Strict `/^[6-9]\d{9}$/` on all phone inputs; a single "Become a driver" conversion flow gated on KYC approval before driver mode activates. Mandatory signup OTP is wired but only enforced once an SMS provider is connected (see F).

## E. Acceptance criteria

1. Logout visible and working from admin console, driver home and account; session cleared, redirect to `/auth`.
2. Admin account page shows no GST/saved-address UI; driver page shows no GST/saved-address UI; customer page unchanged.
3. Cancelling with a reason shows that exact reason plus who cancelled, in all three roles' views. A failed payment never renders as cancelled.
4. Switching a payment-failed booking to cash keeps it active with method Cash; the failed attempt remains in history.
5. No screen shows a bare `lat, lng` string where an address is expected.
6. "Use my location" either returns a location or shows a specific, actionable reason; permission is never requested behind an open overlay; manual pin always available.
7. Review → Book is one tap; no second confirmation gate.
8. Pickup and drop can be corrected from the review screen via the map.
9. Every active vehicle shows payload and dimensions before booking; bike delivery included; disabled vehicles still render in history.
10. Shared link opens for a signed-out recipient, shows live status without phone numbers, OTPs or secrets, and stops working after revoke/expiry.
11. Signup rejects 9-digit, 11-digit and 0/1–5-leading numbers.
12. A customer cannot enter driver mode without approved KYC.
13. Security: non-admin cannot write the new fields; strict blocked-not-hidden checks re-run.
14. 390px mobile: no overflow, no dead controls, no console errors; typecheck, lint, build and dependency scan clean.

## F. Needs an external provider (will not be faked)

- **Mandatory signup OTP** — needs an SMS provider on the backend. Twilio is deferred per your instruction, so I'll build the flow and keep it inactive with honest copy rather than pretending a code was sent.
- **Maps, geocoding, place/street imagery, traffic ETA** — the current Google browser key rejects this preview's address ("referer not allowed"), so maps don't draw here. Code degrades honestly; a key allowing the app's domains is needed for real reverse geocoding, pickup photos and traffic-aware ETA.
- **Payments** — live Razorpay webhook confirmation still needs the provider webhook secret; test paths only until then.
- **WhatsApp** — link/native share only (no business API), which is what the requirement asks for.
