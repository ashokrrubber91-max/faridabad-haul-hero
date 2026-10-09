# MiniPort: unapplied database updates + scheduled bookings (A–D)

## What I found in the live database
- Eleven database update files in the project were never applied. The app code already expects their fields (`booking_source`, `stops`, `is_multi_stop`, `total_stops`), so trip lists are probably failing in the live app right now.
- The "scheduled dispatch cron" doesn't exist yet: the background job tool (pg_cron) isn't turned on, the `scheduled` status isn't there, and neither is a `scheduled_for` column.
- There is no Industrial Credit Ledger (or any merchant credit ledger) in the database.
- Some of the pending files have problems:
  - The multi-stop file has a syntax error (`$;` where `$$;` belongs), so it would fail.
  - The WhatsApp file makes the customer field on a trip optional.
  - Some files redefine ride-accept and admin-assign logic that is already live.

## Step 1: Apply the backlog safely (production)
Apply these in date order. Review each one first, and compare any function it replaces with the live version.
1. `whatsapp_ai_booking_source`: adds a booking-source field, a customer phone field and a WhatsApp message id. It also makes the customer field on a trip optional, which is needed for WhatsApp bookings. This loosens a data rule, so it needs your OK.
2. `harden_withdrawal_wallet_lock_and_refund`, `driver_order_admin_ops_completion`, `harden_admin_driver_assignment`: apply only if they keep today's rules. That means the ₹100 wallet minimum, one active trip per driver, and the KYC checks.
3. `multi_stop_orders_and_parallel_bookings` + backfill + fare trigger: fix the `$;` typo in the file, then apply. Check the new fare trigger still includes the helper fee, coupons and coins.
4. `fix_referral_first_completed_ride`, `force_driver_offline_on_kyc_change`: these overlap with fixes I've already applied. Apply only if they don't undo them.
5. `add_scheduled_booking_status`, `dispatch_scheduled_bookings`: replaced by Step 2, since the cron as written has no payment check and the `scheduled_for` column doesn't exist yet.

## Step 2: Scheduled bookings (A)
- New optional `scheduled_for` date-and-time field on trips, plus the `scheduled` status.
- The database checks every booking: pickup at least 31 minutes from now and at most 30 days ahead. Bookings without a time stay immediate and work exactly as today.
- Booking screen: a date/time picker shown in India time (Asia/Kolkata), checking the same 31-minute to 30-day window.
- A "Scheduled for [date, time]" badge on the customer booking and active-ride screens, and on the driver's incoming ride card.
- One cron job, every minute: moves paid `scheduled` trips to `pending` 30 minutes before pickup. It is created only if it doesn't already exist, so there are no duplicates.

## Step 3: 24-hour reminder (B)
- New `reminder_sent_at` field on trips.
- Same every-minute schedule: find scheduled, non-cancelled, non-completed trips with pickup 24h to 24h+1min away and no reminder sent yet. Mark them first, then add a notification for the customer, and for the driver if one is assigned. A retry can never send it twice.
- These are in-app notifications. Push only works if Firebase is set up, and WhatsApp is not used.
- Cost note: a job every minute keeps the database awake. That's about 1,440 small checks a day.

## Step 4: Payment lock (C)
- Scheduled bookings can't use cash. They stay unconfirmed until Razorpay payment is verified on the server (payment status `paid`). Only paid bookings are dispatched.
- The Industrial Credit Ledger can't be built safely because the database has no ledger. I'll say so rather than fake it.
- Limitation: Razorpay isn't fully connected yet (no live key), so scheduled booking can't be completed end to end until it is.

## Step 5: Cargo weight (D)
- New optional `cargo_weight_kg` field on trips: a positive number, at most 50,000.
- A weight box in the booking flow.
- Shown on the customer and driver screens, and spoken in the driver's voice briefing (for example "750 kg" plus the goods description).

## Then
Run the type and lint checks and the build, check the database security warnings, publish, and report the live link, the latest commit, cron status and any limitations.

## Decision needed
Is it OK to make the customer field on a trip optional (Step 1.1, needed for WhatsApp bookings)? If not, I'll add the WhatsApp fields but keep the customer required.
