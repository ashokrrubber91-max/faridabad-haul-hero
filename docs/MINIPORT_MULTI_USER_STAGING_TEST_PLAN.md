# MiniPort multi-user and physical staging test plan

**Status:** Test plan only. These staging and physical-device scenarios have not been executed.
Do not use production users, production data, or real payments.

## 0. Database schema preflight (must pass before applying this PR)

- Compare the repository migration files with the staging database migration history.
- Verify that every relation referenced by booking, pricing, vehicle matching, and dispatch
  functions exists before invoking those functions.
- The read-only production review on 2026-11-01 found that `public.driver_profiles`,
  `public.vehicle_types`, and `public.platform_settings` were absent from the connected database, while current SQL functions
  and application code reference them. The migration history also did not contain the repository's
  September 2026 vehicle-catalogue migrations.
- Treat this as schema drift. Do not apply this PR migration alone or assume a successful CI build
  proves that the live database has the required schema.
- Reconcile the migration history and restore/validate required schema in a disposable staging
  database first. Confirm vehicle-type data is valid catalogue IDs; registration numbers must never
  be interpreted as vehicle types.

**Pass:** All expected relations, columns, enum types, constraints, policies, and functions exist
in staging, and all migration versions are reconciled before runtime tests begin.

## Before testing

1. Use a separate Supabase staging project and a staging app build.
2. Apply and verify the pending database migrations in staging before testing this PR.
3. Keep the owner-authorized OTP bypass confined to staging. Confirm it is disabled before any
   production release.
4. Create separate test identities: at least 5 customers, 5 drivers, and 1 operations/admin account.
   Use test phone numbers and non-sensitive sample addresses.
5. Create drivers with deliberately different vehicle types, service zones, KYC states,
   online/offline states, and GPS freshness.
6. Use Razorpay test mode and test wallet balances only. Never use real customer funds.

## 1. Customer and booking isolation

- Sign in as Customer A and Customer B on separate devices/sessions.
- Create bookings at nearly the same time with different pickup/drop addresses and vehicle types.
- Confirm A sees only A's bookings and B sees only B's bookings.
- Confirm each booking has a unique ID and the correct customer owner.
- As a driver, attempt to query pending rows directly from `bookings`; it must not expose other
  customers' pending bookings.
- Confirm the driver feed returns only an unexpired offer addressed to that driver.
- Confirm the open-offer payload contains no OTP, customer phone, customer ID, private notes, or
  stop contact phone/email.
- Confirm direct browser INSERT into `bookings` is denied and direct UPDATE of fare, payment state,
  driver assignment, or trip status is denied.
- Confirm a customer can update only the rating/review fields on their own completed booking.

**Pass:** No cross-customer booking, address, contact, OTP, payment, or review data is visible.

## 2. Driver eligibility and matching

Prepare drivers with these combinations:

- Correct vehicle, correct service zone, approved KYC, online, fresh GPS.
- Wrong vehicle.
- Wrong service zone.
- KYC pending/rejected.
- Offline.
- Stale or missing GPS.
- Already on an accepted/in-progress trip.
- Already holding another live offer.

Create bookings for multiple vehicle types and service zones.

**Pass:** Only eligible drivers receive offers. A driver with an active trip or another live offer
does not receive another offer. A wrong vehicle, wrong zone, offline driver, unapproved driver,
or stale-location driver is never selected.

## 3. Concurrent acceptance and dispatch

- Have two eligible driver sessions attempt to accept the same booking at the same time.
- Have one driver session attempt to accept two different bookings at the same time.
- Decline an offer and verify the next eligible driver receives it.
- Let an offer expire and verify the queue advances to the next eligible driver.
- Cancel a booking while an offer is live and verify all outstanding offers are invalidated.
- Disconnect a driver during an offer, reconnect, and verify the feed refreshes without duplicating
  the offer.

**Pass:** Exactly one driver is assigned to a booking; a driver cannot hold two active trips; no
duplicate active offers or mixed booking IDs appear.

## 4. Scheduled bookings

- Create a booking for a future pickup time.
- Confirm its database status remains `scheduled` and its expiry is pickup time plus 30 minutes.
- Confirm it is not offered early.
- At 30 minutes before pickup, confirm it moves to the sequential driver-dispatch flow.
- Test both COD and paid scheduled bookings.
- Confirm reminders go to the correct customer and, once assigned, the correct driver.
- Confirm an expired/cancelled scheduled booking is not offered.

**Pass:** No premature broadcast, no stuck scheduled booking, and no offer after the booking
expiry window.

## 5. OTP and privacy

- Confirm a customer can retrieve OTPs only for their own active booking.
- Confirm a driver cannot read OTP columns through a direct table query.
- Confirm the assigned driver can verify pickup/drop only through the intended verification RPC.
- Try invalid OTPs and verify attempt limits/rate limits work.
- Cancel and complete bookings; confirm private OTP records and attempt records are purged.
- Confirm the test bypass is enabled only in staging and never in a production build/environment.
- Review `private.booking_stop_otps` RLS separately. Browser roles currently have no table privileges;
  do not enable RLS until the trusted stop-OTP RPC access path and required policies are reviewed.

**Pass:** No OTP appears in open-offer feeds, logs, realtime booking payloads, or unauthorized
RPC responses.

## 6. Payment and wallet (sandbox only)

- Test successful, failed, cancelled, and delayed Razorpay sandbox payments.
- Replay the same webhook more than once; wallet credit/payment state must remain idempotent.
- Test wallet-only, wallet-plus-online, and COD flows.
- Test coupon and coin redemption limits.
- Cancel a booking before and after payment; verify the correct refund/settlement state.
- Verify no customer can directly edit fare, commission, wallet deduction, or payment status.

**Pass:** No duplicate debit/credit, no underpaid booking accepted, and no client-side financial
field tampering.

## 7. Physical Android checks

Use separate Android devices and accounts (at minimum one customer device and two driver devices):

- Allow location permission and verify live GPS updates.
- Move one driver device and confirm only its own location is updated.
- Background/lock the driver phone and confirm expected location/notification behavior.
- Switch mobile data/Wi-Fi off and on during an offer.
- Test incoming offer sound, accept, decline, timeout, pickup, OTP verification, delivery/POD, and
  completion.
- Confirm one driver's screen never displays another driver's assigned trip or customer contact
  details.

**Pass:** Correct identity and booking remain attached to each device through reconnects and app
restarts.

## 8. Load and concurrency

Automated unit coverage currently includes:

- 5,000 driver candidates in a matching test.
- 250 independent booking-match requests across 1,000 simulated drivers.

These are pure code-level simulations, not a live database or network load test. For a true load
test, use a disposable staging project and a controlled load generator (for example, k6) with
ramp-up, steady-state, and spike phases. Start small (10, 25, 50, then 100 concurrent booking
requests) and monitor database CPU, query latency, queue depth, offer latency, error rate, and
duplicate assignments. Never load-test production.

## Evidence to record

For each scenario record:

- Staging build commit SHA and database migration version.
- Number of customer and driver test accounts.
- Booking IDs and assigned driver test IDs (do not record real phone numbers).
- Expected vs actual result, timestamps, and sanitized logs.
- Any duplicate assignments, cross-user visibility, stale locations, payment inconsistencies, or
  failed notifications.

## Release gate

Do not call MiniPort production-ready until:

- All CI checks pass.
- All database migrations apply cleanly in staging.
- The multi-user, concurrent-acceptance, scheduled-booking, OTP/RLS, and sandbox payment tests pass.
- Physical Android tests pass on multiple devices.
- OTP testing bypass is securely disabled for production.
- A controlled staging load test shows no cross-user data leakage, duplicate assignment, or
  unacceptable latency.
