# Restore safe 20-second ride acceptance

## Confirmed issue

The current acceptance function checks distance windows but no longer requires a live offer to the accepting driver, checks vehicle compatibility, or closes competing offers. The existing state-machine trigger does not supply those missing checks.

The connected backend has neither the offer table nor the next-driver dispatch function. A simple offer check would therefore break all ride acceptance. The earlier migrations also assume unavailable location infrastructure. Restoring the workflow requires a coordinated change, not replacing the function with its older body.

The pickup/drop OTP columns are absent from the current booking row, so the old explicit OTP nulling is not a present-day disclosure through this return value. Preserve that protection for any schema that includes them.

## Proposed result

- Only the driver with the current, unexpired 20-second offer can accept a ride.
- Online status, approved verification, exact vehicle and service-zone matching remain mandatory.
- Acceptance marks the winning offer accepted and closes competing offers atomically.
- Timeouts and declines offer the ride to the next eligible driver without duplicate offers or duplicate assignments.
- Keep the current nearest-first distance windows when selecting candidates; widening never grants permission to bypass an exclusive offer.
- Do not change fares, payments, wallet settlement, authentication or branding.

## Implementation

1. Reconcile the existing migrations against the inspected schema. Prepare a forward-only repair rather than editing historical migrations or applying the incomplete batch.
2. Restore the offer lifecycle and nearest eligible candidate selection using existing latitude/longitude records; do not introduce a PostGIS dependency.
3. Harden acceptance inside the booking lock with vehicle eligibility and the current offer check. Retain role, verification, online, wallet minimum, active-trip, zone and conditional-assignment safeguards. Close outstanding offers in the same transaction.
4. Align feed and notifications with the authoritative offer. Add scoped realtime updates for offers only after the table is present and published. Fail closed on unavailable offer infrastructure; never expose general acceptance as a fallback.
5. Keep all offer writes server-authoritative and participant access least-privileged, with explicit grants and restricted function execution. Ensure acceptance returns no secret verification codes.

## Verification

On an isolated test backend, test acceptance at 19 seconds versus the exclusive 20-second deadline, wrong/non-offered drivers, wrong vehicle, offline/unverified drivers, declined/expired offers, no pickup coordinates, rides older than 60 seconds, concurrent accepts, offer settlement, and private return data. Verify the same booking cannot acquire multiple drivers and a driver cannot acquire multiple active rides.

Run existing unit tests and lint, inspect automated typecheck/build results, and verify the signed-in offer-to-acceptance flow without creating production bookings.

## Pilot restriction

Approval of this plan does **not** authorize production migrations, records or deployment. Source preparation can proceed; applying and exercising the repair requires an isolated test backend. Production remains unchanged until the testing restriction is explicitly lifted.

## Already completed separately

The driver call-contact issue is repaired in source: endpoint contacts load for single-stop and multi-stop active trips, historical note contacts remain supported, and pickup/drop rows stay outside intermediate-stop verification. Seven new contact tests pass; the full suite has 64 passing tests and lint has zero errors. Signed-in real-trip calling is not yet verified.