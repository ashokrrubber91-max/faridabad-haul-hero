# MiniPort roadmap

## Batch 1 — Auth + role-specific profiles (done)
- [x] Shared sign-out for all roles (`src/lib/session.ts`)
- [x] Admin logout in admin console header + admin profile card
- [x] Role-aware Account page (no GST/saved addresses for admin or driver mode)
- [x] Driver profile: driver photo, POC name/phone/photo, vehicle number/type, KYC docs + status

## Batch 2 — Cancellation + payment-failure semantics (done)
- [x] `bookings.cancelled_by` + `cancellation_category`, backfilled, trusted-write protected
- [x] cancel / admin-cancel / auto-expire record who closed the trip and why
- [x] Shared wording (`cancellationSummary`) in customer rides, trip details, driver history, admin records
- [x] Failed payment never reads as cancelled; same booking switches to cash

## Batch 3 — Location reliability (done)
- [x] `src/lib/geolocation.ts`: permission state check, distinct denied/blocked/insecure/timeout copy, retry
- [x] "Use my location" requested from the tap, honest failure text, manual pin fallback preserved
- [x] No bare `lat, lng` presented as an address (`src/lib/address.ts`)

## Batch 4 — Booking flow (done)
- [x] Review → Book is one tap (goods restrictions kept as informational link)
- [x] Edit pickup / drop on the map directly from Review booking
- [x] Vehicle specifications shown on Review booking

## Batch 5 — Vehicle specifications (done)
- [x] `vehicle_types.length_ft/width_ft/height_ft/payload_kg/spec_notes` (admin-only save RPC)
- [x] Admin vehicle form fields; payload + load size shown on every vehicle card, bike delivery included

## Batch 6 — Driver job addresses (done)
- [x] Readable address first, exact pin as secondary text, navigation still uses stored coordinates

## Batch 8 — Share trip + safety (done)
- [x] `booking_share_links` + token RPCs; public `/trip/$token` page (no phones, codes or fare breakdown)
- [x] Native share / WhatsApp / copy; Emergency 112 kept prominent on active trips

## Batch 9 — Phone validation (partly done)
- [x] Strict 10-digit Indian mobile (`^[6-9]\d{9}$`) on client and enforced by a database trigger
- [ ] Mandatory signup OTP — blocked: needs an SMS provider (Twilio deferred by request)

## Still blocked on external providers
- Signup OTP delivery: SMS provider not connected
- Pickup-area photo / traffic-aware geocoding: Google key rejects this preview's address
- Razorpay live webhook confirmation: provider webhook secret required

## Batch 5–7 completion (this turn)
- [x] Sign-up now requires a real SMS one-time code before the account is created; if SMS sending is not switched on, the person is told plainly and no account is created (no fake/universal code).
- [x] Customer → driver onboarding card on Account: records the application, then documents, then team approval unlocks driver mode (no role change from the browser).
- [x] Driver approach card on active customer trips: driver name, vehicle, call button, readable pickup address, pickup map thumbnail with a neutral placeholder when real imagery is unavailable.
