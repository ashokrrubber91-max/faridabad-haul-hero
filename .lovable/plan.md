# MiniPort — Production Overhaul (Phases 2–5)

This request covers ~25 subsystems. Shipping it in one turn would break more than it builds, so it's split into four phases. Each phase leaves the app fully working.

## Phase 2 (next turn) — Navigation shells + Orders + Wallet + Account

**Customer: persistent 4-tab bottom nav**
- `Home` — "Book Now" / "Drive with MiniPort" cards + the booking form.
- `Orders` — full history (2-year window), status pills, driver name + vehicle number, "Book Again", invoice download link.
- `Wallet` — coins balance, reward ledger, cashback lines, full transaction history, "Add money" and "Transfer to bank" entry points (payment rails wired in Phase 4).
- `Account` — name/email, saved addresses, multiple GSTINs with a default flag, support access, monthly bulk invoice download.

**Driver: 3-screen nav**
- `Home` (request queue) · `My Rides` · `Profile`.
- Active/accepted ride moves to its own dedicated screen.
- Profile: vehicle details, document photos (RC, Insurance, number plate, DL, PUC), net monthly earnings after commission, bank account details for withdrawals + QR.

**Schema:** `customer_gstins`, `driver_bank_accounts`, extra document columns on `driver_kyc`, `booking_invoices` metadata.

## Phase 3 — Booking flow, location, and trip lifecycle

- **Review Booking**: vehicle cards with 3D-style renders, capacity, free loading window; goods allowed vs restricted list; GSTIN selector; flexible coin redemption (custom amount or full balance); T&C block stating loading time and overtime rate up front.
- **Multi-stop**: `booking_stops` table, up to 3 additional pickup/drop points, fare recalculated.
- **Location fixes**: reliable auto-location fetch, map pin selection hardening, paste-a-map-link (Google/WhatsApp share links) → resolves and auto-fills pickup or drop in one tap, explicit "Save address" button (no implicit saves).
- **Loading/unloading timer**: free window starts at pickup OTP entry (90 min for 750 kg class, scaled per vehicle), then ₹2/min overtime accrued server-side onto the fare.
- **Driver wait/cancel**: cancel option appears only after a 5-minute wait timer once the driver is at pickup.
- **Proof of delivery**: drop OTP required, optional goods photo upload.
- **Post-trip**: rating flow unlocked on completion + downloadable PDF tax invoice (SAC 9965/9967, CGST/SGST/IGST split).

## Phase 4 — Auth, payments, live tracking

- **Auth**: Phone OTP (Twilio Verify via connector), Google Sign-In, Apple Sign-In, persistent sessions.
- **Dual-role switching**: role toggle; a customer can create a driver profile from the Driver section and vice-versa, sharing one login.
- **Live tracking**: `driver_locations` table + realtime pings from the driver screen replace the current simulated marker; customer sees driver name, vehicle number, phone, and a continuously updating map + ETA once pickup OTP is entered.
- **Wallet money movement**: UPI/card top-up and bank transfer via a payment provider.

## Phase 5 — Verification gate, dispatch, AI support

- **Approval gate**: drivers cannot go online, receive requests, or get notifications until KYC is approved (enforced in RLS, not just UI).
- **Dispatch**: online-only targeting; incoming request shows a full-screen, call-style overlay with ringtone and vibration.
- **AI chatbot**: reads live KYC approval status; adds voice in/voice out for drivers who can't type.

## Known limitation to decide on

True background execution with an app-off ringing overlay is not possible in a web app. Realistically the web app can do: web push notifications, a full-screen ringing overlay with sound + vibration while the tab is alive or the PWA is installed and backgrounded. A genuine always-listening background service needs a native wrapper (Capacitor) shipped to the Play Store. I'll build the PWA/push version in Phase 5 unless you want to go native.

## Ordering note

Phases can be reordered. If a specific item is blocking you right now (e.g. location/map fixes or the driver approval gate), say so and I'll pull it forward.
