# MiniPort production security audit — 2026-10-03

## Scope
This audit covers the seven requested hardening phases across the web/PWA codebase, Supabase schema/RLS, payment/webhook paths, offline driver tracking, Capacitor bridges, role separation, referrals, payouts and automated-test configuration.

## Database controls verified
- 28/28 public tables currently have RLS enabled.
- Anonymous table grants were removed from the protected MiniPort tables; the remaining wallet-ledger anon grant was found during this audit and revoked.
- Server-owned tables wallet_accounts, driver_daily_passes, merchant_billing_cycles, and booking_documents have zero direct authenticated INSERT/UPDATE/DELETE table grants.
- driver_locations INSERT/UPDATE policies require auth.uid() = driver_id.
- profiles SELECT is now restricted to the signed-in user's own row or admins.
- user_roles INSERT is admin-only.
- Privileged profile fields are protected by server/database controls rather than trusting client writes.
- Additional range constraints now reject invalid GPS coordinates, negative accuracy/speed, invalid heading, helper counts outside 0–2, negative helper/insurance/cargo values, malformed referral codes and implausibly sized push tokens.

## Intentional Security Advisor warnings
Supabase still reports 11 authenticated SECURITY DEFINER RPC warnings. These are intentional RPC APIs used by signed-in customers/drivers/admins: activate_driver_daily_pass, admin_send_broadcast, admin_set_driver_online, attach_delivery_signature, has_role, merchant_monthly_statement, reserve_driver_payout, schedule_booking_dispatch, set_my_active_mode, set_my_online, and validate_coupon.
Each function contains its own authorization/ownership validation. The warnings are the generic Supabase lint for an exposed SECURITY DEFINER RPC, not an indication that anonymous access remains. Anonymous access is zero on the protected tables.

## Payments
Razorpay callback/webhook verification uses HMAC-SHA256 with constant-time comparison. Missing/invalid webhook signatures are rejected with HTTP 400, and webhook events are deduplicated.
RazorpayX payouts reserve the wallet balance transactionally before payout creation and settle the reservation after the provider response.

## Driver POD / OTP
Drop OTPs are excluded from the normal booking field projection. POD photo + receiver signature are required before the driver can continue to Drop OTP verification. Images are compressed client-side before upload.

## Offline and mobile
Driver GPS updates are throttled to one database write per driver per 10 seconds and queued in IndexedDB/localStorage when offline. The queue retries with exponential backoff after reconnect.
Native Capacitor bridges exist for geolocation, camera, notifications, push tokens, status bar and Android back button. Permission onboarding runs once after successful login; it does not silently fake permissions. Background location is intentionally not requested.

## Referral rules
Referral codes are unique. There is no global invite cap. A referred customer earns the referrer ₹100 when the customer books their first ride; a referred driver earns ₹100 when the driver's first qualifying ride completes. Rewards are database-triggered and idempotent per referred user.

## Driver Account Profile
Driver profile UI is separated from customer profile data. It shows vehicle/KYC/earnings/completed rides/withdrawal-related information. Customer-only GST numbers, saved addresses and customer invoice downloads are not part of the driver profile source.

## Verification
The repository contains CI for frozen Bun install, TypeScript typecheck, ESLint with zero warnings, Vitest unit tests, production build, dependency audit and Playwright E2E.
The live Lovable project is synced to commit 7ad10c7f9db2af3217c10f4c7819b4a6b04d70f3 and is in ready state. GitHub Actions did not expose a workflow run for the checked commits, so a separate GitHub Actions pass could not be independently observed from the connector.

## Follow-up for native release
For a signed Android AAB, install the documented Capacitor packages, run bun run typecheck, bun run lint, bun run build, bunx cap sync android, open Android Studio, configure Firebase/FCM and a private release keystore, then generate the signed AAB. Do not commit the keystore or native secrets.