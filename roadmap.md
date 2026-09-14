# MiniPort roadmap

## Batch 1 — Auth + role-specific profiles (in progress)
- [x] Shared sign-out for all roles (`src/lib/session.ts`)
- [x] Admin logout in admin console header + admin profile card
- [x] Role-aware Account page (no GST/saved addresses for admin or driver mode)
- [x] Driver profile: driver photo, POC name/phone/photo, vehicle number/type, KYC docs + status
- [ ] Verify: typecheck, lint, build, dependency scan, signed-in walkthrough

## Later batches (not started)
- Batch 2 — cancellation reason/category + payment-failure semantics
- Batch 3 — geolocation permission reliability + manual pin fallback
- Batch 4 — remove duplicate confirm step; map edit on review booking
- Batch 5 — vehicle specifications (dimensions/payload) config + display
- Batch 6 — driver job human-readable addresses
- Batch 7 — driver approach ETA card + pickup-area photo
- Batch 8 — public share-trip link + safety
- Batch 9 — strict 10-digit phone validation, signup OTP (needs SMS provider), role conversion flow

## Blocked on external providers
- Signup OTP: needs an SMS provider (Twilio deferred by request)
- Maps/geocoding/place photos: Google key rejects preview referrer
- Razorpay live webhook confirmation: needs provider webhook secret
