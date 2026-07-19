This is a large multi-feature request. I'll ship it in three focused phases so each part is testable before moving on. Confirm and I'll start with Phase 1.

## Phase 1 — Driver Incentives, Commission & Wallet

Backend (one migration):
- Add columns to `bookings`: `commission_rate` (default 0.10), `commission_amount`, `driver_net_earning`, `pickup_otp`, `drop_otp`, `pickup_verified_at`, `drop_verified_at`.
- Add columns to `wallet_accounts`: `cash_balance` (driver payout wallet, separate from customer coins).
- New table `driver_incentive_config`: daily targets (rides → bonus) — seeded with `5 rides = ₹50`, `10 rides = ₹150` (₹200 total at tier 2).
- New table `driver_incentive_earnings`: log of incentive credits per driver per day.
- Update `bookings_award_coins` trigger → also computes commission + net earning on completion, credits `wallet_accounts.cash_balance` for online-paid trips, debits ₹commission for cash trips.
- Nightly incentive settlement: RPC `settle_daily_incentives()` (admin-callable) that reads completed trip counts per driver and credits due bonus.

Driver UI (`/driver`):
- Header stats: Today's Earnings, Trips Completed, Daily Incentive Progress (`2/10`).
- New **Incentive card** with milestone progress bars: `5 rides = ₹50 🟢`, `10 rides = ₹150 🚀`, "Complete X more to unlock ₹Y".
- Reward summary: "Total Incentive Earned Today: ₹X", "Credited at 12:00 AM".
- Wallet warning banner when `cash_balance < ₹100`: "Top up to keep receiving jobs".
- Trip completion card shows commission breakdown: Fare / -Commission / Net Earning.
- Payment mode indicator on active job ("Collect ₹500 cash" vs "₹450 to wallet").

New `/driver/wallet` route:
- Available balance, "Transfer to Bank / UPI" button (UI only, marked "Coming soon" like other payment methods).
- Transaction history from `wallet_transactions` with clear labels.

## Phase 2 — Active Trip Flow with OTP

- Booking creation generates 4-digit `pickup_otp` and `drop_otp` (customer sees them in `/customer` active trip card).
- Driver active job card gains:
  - Call customer button (`tel:` link).
  - "Verify Pickup OTP" input → transitions status to `in_progress`.
  - "Verify Drop OTP" input → transitions status to `completed`.
- Replace existing "Start trip" / "Mark completed" buttons with OTP-gated versions.
- 30s accept countdown on pending job cards (auto-dismiss visually, doesn't cancel booking).

## Phase 3 — AI Chatbot (Customer + Driver)

- Floating "💬 Help & Support" button on both `/customer` and `/driver`.
- Chat drawer with message bubbles + "AI Bot is typing…" indicator.
- Quick-reply chips per role:
  - Customer: `Where is my driver?`, `Fare dispute`, `Cancel my ride`, `Speak to a Human`.
  - Driver: `Incentive nahi mila`, `Wallet top-up issue`, `Customer phone off hai`, `Emergency`.
- Powered by Lovable AI (`google/gemini-3.5-flash`) via a TanStack server route `/api/chat` streaming through the AI SDK.
- System prompt injects: user role, latest booking status/ETA, today's ride count, wallet balance, incentive progress — so replies are grounded, not generic.
- Quick-reply taps pre-fill the message; escalation reply shows "Connecting you to Faridabad support…" banner.

## Technical Notes

- All SQL in one migration per phase, with GRANTs + RLS policies (driver reads own incentives; customer reads own bookings including OTPs).
- Commission % configurable per-vehicle later; hardcoded 10% for now.
- Chatbot uses AI Elements (`conversation`, `message`, `prompt-input`, `shimmer`) — installed via `bunx ai-elements@latest add`.
- No new secrets needed (LOVABLE_API_KEY already set).

Reply "go" to start Phase 1, or tell me which phase to do first / what to change.