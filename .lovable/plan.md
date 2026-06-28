# Miniport Super App — Phased Build Plan

Your message was truncated mid-sentence in Module 2.1 ("…unmount customer booking flows and"). I'll proceed on the assumption that the rest is "…mount the driver dashboard, with a single hamburger/profile switcher to return to Customer Mode" — flag if wrong.

This scope is ~6–8 features deep. Shipping it in one commit would be unreviewable and likely break the working booking flow. I'll cut it into 5 phases, each independently testable. **Tell me which phase to start with** (default: Phase 1).

---

## Phase 1 — Dual-Role State & Routing (foundation for everything else)
- Add `active_mode` ('customer' | 'driver') to `profiles`, default 'customer'.
- Global `useActiveMode()` hook + a header switcher (only visible to users with `driver` role).
- Route guard: in driver mode, `/customer` redirects to `/driver` and vice versa. Tabs in the authenticated layout filter by `active_mode`, not just role.
- Driver dashboard gets a proper landing view (online/offline toggle, today's earnings, active job card) — currently it's just the request queue.

## Phase 2 — Checkout: Coupons, Miniport Coins, Payment Methods
- Tables: `coupons` (code, type, value, min_fare, expires_at, max_uses), `coupon_redemptions`, `wallet_accounts` (user_id, coins_balance, cash_balance), `wallet_transactions`.
- Booking form gets: promo code input (server-validated via `validate_coupon` RPC), coins redemption slider (cap = min(balance, 50% of fare)), payment method radio (COD / Wallet / UPI / Card / Netbanking).
- On `completed` status, trigger awards 2% of fare as coins to customer.
- Payment processing is **stubbed** at this phase (records intent + marks paid for COD/Wallet; UPI/Card/Netbanking show "coming soon" until Phase 5).

## Phase 3 — Location Intelligence Upgrades
- **Clipboard auto-fetch**: on customer page focus, read `navigator.clipboard.readText()` (with permission prompt + dismissible banner — browsers require user gesture), regex-match `maps.google.com`/`maps.app.goo.gl`/`goo.gl/maps` and lat,lng patterns, resolve via Geocoding through the Maps gateway, and offer "Use this location?" toast.
- **Saved location photos**: add `photo_url` to `saved_addresses`, create `saved-address-photos` storage bucket (RLS by owner), upload UI in `MapPinConfirm`.
- Saved-address list in search overlay shows thumbnail + alias prominently.

## Phase 4 — B2B / GST Invoicing
- Add `is_business`, `business_name`, `gstin` to `bookings` (nullable). Validate GSTIN with the 15-char regex.
- Toggle in customer booking form; when on, show business name + GSTIN fields.
- On completion: server function generates a PDF (pdf-lib, edge-runtime safe) with Miniport's GSTIN, customer GSTIN, fare breakdown (base + distance + GST 18%), saves to `invoices` bucket, links via `bookings.invoice_url`. Customer + admin can download.

## Phase 5 — Real Payments + Driver Telemetry
- Wire UPI deep-linking (`upi://pay?...`) for mobile, and (separately) ask which gateway you want for cards/netbanking — **Razorpay is the standard for India**; Stripe doesn't take INR domestic cards well. Needs your call + API keys.
- Driver telemetry: while a booking is `in_progress`, driver page posts `navigator.geolocation.watchPosition` to a `driver_locations` table (RLS: driver writes own, customer reads only their active booking's driver). Customer sees a live marker on the map.

---

## Technical notes (shared across phases)
- Stack stays as-is: TanStack Start + Supabase + Google Maps connector.
- All new tables get explicit `GRANT`s + RLS scoped to `auth.uid()`, per project rules.
- Coupon validation, coin redemption, and invoice generation run server-side (`createServerFn` with `requireSupabaseAuth`) — never trust the client for fare math.
- Role/mode switching uses the existing `user_roles` table; **`active_mode` is a UI preference, not a permission** — RLS still checks `has_role`.

---

## What I need from you
1. **Confirm the truncated sentence** at end of 2.1.
2. **Which phase first?** (recommend Phase 1 — everything else depends on dual-role being clean).
3. **Payment gateway** for Phase 5: Razorpay, Cashfree, or other? (Stripe not recommended for India intra-city COD/UPI.)
4. **Miniport's own GSTIN + registered business name** for invoices (Phase 4) — needed as a secret/config.
