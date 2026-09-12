# MiniPort backend data model

## Persistence architecture (single source of truth)

The Supabase Postgres project **`dpxaelivsmszrneyitoy`** is the one and only
permanent store for every MiniPort business record: customers, drivers, bookings
and stops, payments and webhook events, wallets and ledger, withdrawals, coupons
and redemptions, KYC (rows + private storage objects), invoices (derived from
booking rows), proof-of-delivery, GPS/trip data, notification/SMS logs and audit
logs. This is the same instance Lovable Cloud provisions and manages — there is
no second business database anywhere in the project.

Rules for future changes:

- Never introduce another database, ORM or hosted data service for business
  records. All reads/writes go through `@/integrations/supabase/client` (browser,
  RLS), the `requireSupabaseAuth` server-function context, or — for privileged
  server-only work — `@/integrations/supabase/client.server`.
- Non-Supabase services are runtime-only and must not hold business state:
  Firebase Cloud Messaging (push transport only — no Firestore / Realtime
  Database), Twilio (SMS transport; delivery records live in `sms_logs`),
  Razorpay (payment provider; state mirrored into `payments`/`webhook_events`),
  Google Maps (geocoding/routing), Lovable AI Gateway (support chat inference).
- Browser storage is cache/UX only. The single permitted key is the FCM token
  marker in `usePushNotifications`; the authoritative token row is
  `device_tokens`. Auth session storage is Lovable-generated and off limits.
- Files: only the private `driver-kyc` and `delivery-proof` Supabase Storage
  buckets. No third-party file host.
- Secrets never live in source. The committed `.env` is Lovable-generated and
  holds only public/publishable values (Supabase URL + anon key, Google Maps
  browser key). Every private credential (`SUPABASE_SERVICE_ROLE_KEY`,
  `RAZORPAY_*`, `TWILIO_*`, `FIREBASE_SERVICE_ACCOUNT_JSON`,
  `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY`) is read from the server environment
  inside handlers only.


Canonical reference for the Supabase (Lovable Cloud) schema. Every table lives in
`public` unless stated otherwise, has RLS enabled, and explicit grants. The auth
user UUID (`auth.users.id`) is the canonical identity for every domain — customer,
driver and admin records are keyed to it, never duplicated with a new id.

Domains: **Identity**, **Customer**, **Driver**, **Booking**, **Finance**,
**Rewards**, **Operations**.

## Identity

| Table | Purpose | Owner / access | Notes |
| --- | --- | --- | --- |
| `profiles` | Minimal shared account state: `name`, `phone`, `active_mode`, `is_online`, `kyc_status` mirror, `service_zone` | Own row + admin | Authenticated UPDATE grant limited to `name`, `phone`, `is_online`, `active_mode`; privileged fields pinned by `profiles_protect_privileged_fields()` |
| `user_roles` | Only source of truth for authorisation (`customer`/`driver`/`admin`) | Own row read; writes server-side | `has_role()` is used by every policy; signup always inserts `customer` |

## Customer domain

| Table | Purpose | Owner / access |
| --- | --- | --- |
| `customer_profiles` | 1:1 customer-only settings (`marketing_opt_in`) | Own row + admin |
| `customer_gstins` | GST numbers for tax invoices; `is_default` marks the preferred one | Own rows + admin |
| `saved_addresses` | Saved pickup/drop addresses | Own rows |
| `device_tokens` | Push tokens; genuinely shared across both modes, so kept generic | Own rows |

`customer_profiles.default_gstin_id` is **deprecated / reserved** — the canonical
default GSTIN remains `customer_gstins.is_default`, which the app reads. Nothing
writes the column; it is kept rather than dropped to avoid a destructive change.

## Driver domain

| Table | Purpose | Owner / access |
| --- | --- | --- |
| `driver_profiles` | 1:1 operational state: `vehicle_type`, `vehicle_number`, `payout_hold` | Own row + admin; `payout_hold` is ops-only (trigger reverts driver edits) |
| `driver_applications` | Application lifecycle (`submitted`/`approved`/`rejected`/`withdrawn`) | Own row + admin; only admins may change `status`. Role stays `customer` until approval |
| `driver_kyc` | KYC documents (private storage paths), review status, audit fields | Own row + admin only — never customers or other drivers |
| `driver_bank_accounts` | Payout bank/UPI details | Own rows + admin only |
| `driver_locations` | Latest GPS ping | Driver writes own; customer of an active trip and admins read |
| `driver_booking_passes` | Skipped trips, keeps them out of a driver's queue | Own rows |
| `driver_incentive_config` / `driver_incentive_earnings` | Daily bonus config and settled bonuses | Config admin-managed; earnings own rows + admin |

`driver_profiles` and `driver_applications` are kept in step with `driver_kyc`
automatically by `sync_driver_domain_from_kyc()`.

## Booking domain

| Table | Purpose | Owner / access |
| --- | --- | --- |
| `bookings` | Central trip aggregate: addresses, vehicle, distance, fare, status, payment and verification state | Customer, assigned driver, admin |
| `booking_stops` | Ordered itinerary: `sequence` 0 = pickup, 1–3 = extra stops, 10 = drop; address, lat/lng, `place_id`, contact name/phone | Trip participants + admin; insert only by the customer on a `pending` trip |
| `booking_otp_attempts` | OTP attempt counter and lockout | Server-side only |
| `private.booking_otps` | Pickup/drop OTPs | No app-role grants, deny-all RLS; reachable only through `get_booking_otps()` / `verify_booking_otp()` |

Server-authoritative fields (never client-writable): `status`, `driver_id`,
`fare`, `distance_km`, `commission_*`, `driver_net_earning`, `payment_*`,
`pickup_verified_at`, `drop_verified_at`, `pod_photo_url`, `service_zone`,
`expires_at`. Authenticated UPDATE grants cover only `notes`, `rating`, `review`
and the loading/unloading timestamps.

## Finance domain

| Table | Purpose | Notes |
| --- | --- | --- |
| `payments` | Provider order/payment state only | Unique `provider_order_id` and `provider_payment_id`; no provider secrets stored |
| `webhook_events` | Provider webhook idempotency log | Unique `(provider, event_id)` |
| `wallet_accounts` | Current coin/cash balance snapshot | Written only by server functions/triggers |
| `wallet_transactions` | Append-only ledger | Own rows read; no client insert/update/delete |
| `withdrawal_requests` | Driver payout requests | Amount, balance, minimum and role validated by `withdrawals_validate()` |

## Rewards domain

| Table | Purpose |
| --- | --- |
| `coupons` | Coupon master config (`kind`, `value`, caps, uses, expiry) |
| `coupon_redemptions` | Per-user, per-booking redemption ledger; unique per booking prevents reuse and races |

Coin balances are only ever changed through wallet ledger triggers/RPCs — never
from the client.

## Operations domain

| Table | Purpose |
| --- | --- |
| `audit_logs` | Append-only audit trail; admin/service-role read only |
| `sms_logs` | Outbound SMS delivery records |

## Security rules that must not regress

- Customer A can never read or write Customer B's rows; Driver A can never reach
  Driver B's KYC, bank, wallet, withdrawal, location or earnings.
- Admin/ops access is always via `has_role(auth.uid(),'admin')` or a server-side
  role check — never a client flag.
- OTP values, KYC document contents, bank account numbers, raw audit payloads and
  payment provider secrets are never exposed to ordinary authenticated users.
- Every `SECURITY DEFINER` routine has a fixed `search_path` and least-privilege
  execute grants (`PUBLIC`/`anon` revoked; internal trigger helpers revoked from
  `authenticated` too).
- Storage buckets `driver-kyc` and `delivery-proof` are private, 10 MiB limit,
  with owner/admin-scoped object policies.

## Migration policy

Additive first: create, backfill, then constrain. Old columns/tables are
deprecated and documented rather than dropped, so historical bookings, payments
and wallet history stay readable.
