# MiniPort — Google Play & App Store release gate

Last reviewed: 2026-09-16

This is a release gate, not a guarantee of approval. Google and Apple make the final review decision. Nothing here may be marked done on the basis of intent — only on verified behaviour of the exact build being submitted.

## 1. Verified in application source

- **Consent at account creation.** Sign-up requires an explicitly unchecked-by-default agreement to the Terms & Conditions and Privacy Policy, with both documents linked and opening the public pages. The create-account action cannot complete without it. Ordinary sign-in is not interrupted.
- **Consent records.** `user_consents` stores account id, terms version, privacy version, timestamp and source (`signup` / `reconsent`). Rows are insert-and-read only; each account reads its own, admins read all. A version bump surfaces an in-app re-consent card instead of silently assuming acceptance.
- **In-app account deletion.** Account → Delete account requires a typed `DELETE` confirmation, then runs the server-side `delete_my_account()` routine scoped to the caller's own id, removes stored KYC/vehicle/proof files, deletes the login itself and signs out everywhere. One account can never delete another; there is no admin-only-only deletion path. Deletion is refused while a trip is open. `account_deletions` records that a deletion happened, without personal data.
- **Retention on deletion.** Completed trip/payment/payout records are detached from the deleted account and stripped of personal fields rather than destroyed, matching the disclosure in the privacy policy.
- **Public deletion resource.** `public/delete-account.html` describes the in-app path, the off-app request path, what is deleted, what is kept and why, with no fabricated support address.
- **Privacy policy accessible in-app** from the Account screen and as a public page, describing the data this codebase actually handles: name/mobile/login, booking addresses and coordinates, precise location, driver KYC and vehicle documents, payout and payment status, notification/device tokens, proof-of-delivery photos, support conversations.
- **Location minimisation.** Geolocation is requested only from an explicit user action on a feature that needs it, never from behind a modal; denied/off/timeout/stale states produce plain guidance plus a manual address-search and map-pin fallback. No background-location code and no claim of background permission. No fabricated coordinates, distance or ETA — the live trip shows real values or an honest latest-known state.
- **Driver tracking scope.** Live driver location is shared for active service only, with a single watcher, stale detection and cleanup; rows are readable only by the parties to the trip.
- **Access boundaries.** Row-level security on every user table, role storage separate from profiles, server-authoritative fares, commissions, booking states, OTP verification, assignments, wallets and payouts. Public trip-share links expose non-sensitive trip details only — no phone numbers, OTPs, fares or tokens — and expire and can be revoked.
- **Authentication.** Mobile number verified by a real one-time code before an account becomes usable; no universal or fake code exists. No Android SMS or Call Log permission is used or needed. Sign in with Apple is **not** implemented and is not claimed anywhere.
- **Payments.** Physical transport is charged through the external payment provider, server-authoritative, with booking lifecycle state kept separate from payment state; a failed payment is never recorded as a cancellation and the same booking can switch to cash. No in-app-purchase billing is used for rides.
- **Safety.** The in-trip Emergency 112 action hands off to the phone's dialler and claims nothing more; trip sharing is described accurately.

## 2. Needs production configuration (cannot be satisfied by source)

- SMS provider credentials so sign-up verification codes are actually delivered. Until then sign-up fails closed with a clear message and no account is created.
- A Google Maps key authorised for the production origin (maps rendering, geocoding, place imagery).
- Payment provider live keys and the webhook signing secret; run a real end-to-end paid booking.
- Push notification (Firebase) production credentials.
- Real privacy/support contact published on the privacy page, the deletion page and the store listings.
- Legal review of the privacy policy, terms, retention periods and transport terms.

## 3. Needs Play Console / App Store Connect entries

- Play **Data safety** form completed from the production build and every bundled SDK: location, personal info, financial/payment info, photos/files, authentication info, device/notification identifiers, plus the data-deletion questions (declare both the in-app path and the public deletion URL).
- Apple **App Privacy** questionnaire completed from the shipped iOS build and its SDKs, with the Privacy Policy URL.
- Privacy policy URL, account-deletion URL, app category and content rating.
- Review credentials/test accounts for customer, driver and admin, with notes covering booking, assignment, KYC, payment, location and cancellation flows. Never hand reviewers production secrets.
- Any declaration required for permissions actually shipped by the native wrapper.

## 4. Needs a native wrapper (not in this repository)

- Android project targeting API 36 or higher for submissions on/after 2026-08-31, with signing and the Play developer verification steps.
- iOS project: bundle identifier, signing, permission purpose strings for location, camera and photos, privacy manifest, push configuration. If Sign in with Apple is ever added, token revocation must be wired into the deletion flow.
- A real-device GPS test through the production shell.

## Release rule

Do not submit until every item in sections 2–4 is verified against the exact production build and the store forms match the real data flows. The app is not "approved" until an actual store review says so.
