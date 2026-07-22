# Miniport Production Overhaul — Phased Plan

The request spans ~15 subsystems. Shipping it all in one turn would break more than it builds. I'll deliver it in four phases, each independently working. This plan covers Phase 1 in detail and outlines 2–4.

## Phase 1 (this turn) — Map bug + Live tracking + Driver KYC

### 1A. Fix blank map in `MapPinConfirm`
Root cause: the sheet mounts with `initial=null` in some flows, and the `useEffect` bails when `initial` is falsy so `new google.maps.Map` never runs. Also the container is inside a scroll region that can render with `height: 0` before Maps initializes.

Changes in `src/components/booking/MapPinConfirm.tsx`:
- Always initialize the map on `open`, defaulting to `FARIDABAD_CENTER` when `initial` is null.
- Give the map container explicit `height: 350px; width: 100%` (not viewport-relative) and a helper label "Drag pin to set exact location".
- Add `google.maps.event.trigger(map, "resize")` after mount in case the sheet animates in.
- Red pin using `SymbolPath` marker so it's visible even before tiles finish.

### 1B. Live driver tracking on customer active booking
New file `src/components/booking/LiveTripMap.tsx`:
- Google Map showing pickup + drop markers, polyline route via `DirectionsService`.
- Driver marker position:
  - Before pickup OTP verified: animates from a simulated origin toward pickup (interpolated every 3s, since no real telemetry exists yet).
  - After pickup OTP verified (booking status `in_progress` AND `pickup_verified_at` set): animates from pickup toward drop, and the route re-renders pickup→drop.
- ETA text derived from remaining distance / 25 km·h.

Wire into `src/routes/_authenticated/customer.tsx`:
- Replace the existing "Driver is X km away" static banner with `<LiveTripMap booking={activeBooking} />` inside the active booking card.
- Height 260px on mobile, 320px on desktop.

Realtime already subscribes to booking changes; no schema change needed for the visual switch — we key off `status` + existing `pickup_verified_at`.

### 1C. Driver KYC onboarding + admin approval

**Schema (single migration):**
- `driver_kyc` table: `driver_id` (PK, FK profiles), `full_name`, `city`, `vehicle_id`, `dl_front_url`, `dl_back_url`, `rc_url`, `id_proof_url`, `vehicle_photo_url`, `status` (`pending|approved|rejected`), `rejection_reason`, `submitted_at`, `reviewed_at`, `reviewed_by`. RLS: driver reads/writes own row; admin reads/updates all.
- Storage bucket `driver-kyc` (private). RLS: driver uploads to `{driver_id}/...`; admin reads all.
- Add `kyc_status` column to `profiles` (default `not_submitted`), synced by trigger from `driver_kyc.status`.

**Driver flow:**
- New route `src/routes/_authenticated/driver-kyc.tsx` — 3-step wizard (Personal → Vehicle → Documents with previews).
- `src/routes/_authenticated/driver.tsx`: if role is driver and `kyc_status !== 'approved'`, render a lock screen with status banner ("Verification Pending — reviewed within 24 hours" / "Rejected: {reason}" / CTA to start submission) instead of the dashboard.

**Admin flow:**
- New "KYC Approvals" tab in `src/routes/admin.tsx` — list of pending submissions with document thumbnails, Approve / Reject (with reason) buttons.

## Phase 2 (next turn) — 4-tab bottom nav + Orders + Wallet + Account
- `src/components/nav/BottomNav.tsx` with 4 icons; visible only for customers.
- Split `customer.tsx` into `home.tsx` (booking form), `orders.tsx` (active/completed/cancelled with CRN, status pills, PDF/consignment note links), `wallet.tsx` (already exists — extend with Add Money placeholder + ledger), `account.tsx` (profile, saved addresses, GSTIN, support).
- Move existing booking form into Home tab; keep route paths stable via redirects.

## Phase 3 — Review Booking upgrades + Flexible coins + GST + Multi-stop
- Vehicle card with photo/capacity/loading window.
- Goods category + weight picker + restricted-items advisory.
- GST toggle → CGST/SGST/IGST split (add `gstin`, `business_name`, `tax_breakup` JSON to bookings).
- Coins: checkbox for max redeem + numeric input for custom amount, live total.
- Multi-stop: `booking_stops` table (up to 3), recalculated fare.
- POD: drop OTP already exists; add optional receiver photo upload + e-way bill field for orders >₹50k.
- Completed trip: 5-star rating modal (already partly exists via `rating` column), PDF tax invoice (client-side jsPDF with SAC 9965/9967), Book Again.

## Phase 4 — Auth revamp
- Configure Google via `supabase--configure_social_auth`.
- Connect Twilio connector; add `/api/public/otp/send` and `/api/public/otp/verify` server routes that call Twilio Verify.
- Rebuild `src/routes/auth.tsx`: Customer/Driver toggle at top, "Continue with Google" button, phone input → 6-digit OTP screen, remove disclaimer.

## Out of scope for this plan
- Real driver GPS telemetry (Phase 1B simulates until we add a `driver_locations` table + realtime pings from the driver app).
- Real UPI/card top-ups in Wallet (Add Money will be a placeholder; wiring Razorpay/Stripe is a separate ask).
- E-Rickshaw vehicle option — needs fare config; folded into Phase 3 with the vehicle grid rework.

## Technical notes
- Google Directions API is enabled via the existing Maps browser key; no new secret.
- KYC uploads go through the browser Supabase client with signed URLs read by admin.
- Twilio requires `standard_connectors--connect` (Phase 4) — you'll pick the connection when I run that step.

Confirm this phasing and I'll execute Phase 1 immediately. Reply "go" to proceed, or tell me to reshuffle.
