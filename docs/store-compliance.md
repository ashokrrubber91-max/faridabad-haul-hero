# MiniPort — Google Play & App Store release compliance checklist

Last reviewed: 2026-09-14

This checklist is based on the current Google Play and Apple requirements. It is a release gate, not a guarantee of approval.

## Already covered in the product/codebase

- Account authentication and role separation.
- Customer/driver privacy boundaries and RLS.
- Location permission is requested only when a location feature needs it, with manual-address fallback.
- Emergency 112 and trip sharing are user-facing safety actions.
- Payment failures are kept separate from ride cancellation; a failed online payment can be switched to cash on the same booking.
- Driver KYC and vehicle-document flows are separated from customer account data.
- Prohibited-goods acknowledgement is shown before booking.
- Admin-only financial/vehicle configuration is protected server-side.
- Real driver GPS is treated as stale/unavailable when the latest fix is too old; the UI does not invent a GPS position.

## Mandatory before store submission

### 1. Privacy policy

Publish the MiniPort privacy policy at a permanent HTTPS URL and link it from inside the app. It must accurately cover phone/name, account data, precise location, driver KYC documents, vehicle documents, bank/payout information, payment data, notifications/device tokens, trip photos/POD, support conversations, and third-party services such as Supabase, Google Maps, Firebase, Razorpay and any AI provider actually used.

### 2. Account deletion

The app creates accounts, so deletion must be a real deletion flow, not only logout, deactivation, or an email request. Provide a clearly discoverable Account → Delete account action and an external web deletion resource. Delete associated personal data, except data that must legally be retained and is clearly disclosed in the privacy policy. If Sign in with Apple is used, revoke the Apple authorization/token as part of deletion.

### 3. Google Play Data Safety

Complete the Play Console Data safety form from the actual production build and third-party SDK behavior. Declare location, personal information, financial/payment information, photos/files, authentication information, device/notification data and any AI/analytics sharing that is actually present. Also complete the account/data deletion questions.

### 4. Apple App Privacy

Complete App Store Connect App Privacy from the actual iOS build and all third-party SDKs. Provide the Privacy Policy URL. Keep the in-app privacy/deletion controls easy to find.

### 5. Google Play target API

For a new Android app submitted on/after 2026-08-31, the native Android package must target Android 16 / API 36 or higher. This web repository currently does not contain an Android native project, so the eventual Capacitor/native Android wrapper must be configured to API 36+ before upload.

### 6. iOS native packaging

The current repository is a web application; there is no committed Xcode/iOS project. Before App Store submission, create the iOS wrapper, configure bundle identifier, signing, permissions strings, privacy manifests where applicable, Apple Sign in token revocation, production URLs, push configuration and App Store Connect metadata.

### 7. Review access

Prepare stable review credentials/test accounts for customer, driver and admin review where needed. Do not give reviewers production secrets. Provide review notes explaining how to reach booking, driver assignment, KYC, payment, location and cancellation flows.

### 8. Production integrations

Before submission, verify production configuration for SMS/phone OTP, Razorpay live payments/webhooks, Google Maps billing/API restrictions, Firebase push, and any AI/support provider. A UI message saying an integration is configured is not enough; run a real end-to-end test.

## Current blockers that cannot be solved by source code alone

- Native Android/iOS packaging and signing.
- Play Console / App Store Connect declarations and developer verification.
- Live SMS provider credentials and sender configuration.
- Razorpay production webhook secret and live payment verification.
- A real-device GPS test with the production native shell.
- Legal review of the privacy policy, retention periods and transport terms.

## Release rule

Do not submit the store builds until every item above is verified against the exact production build and the store forms match the real data flows. No code change can honestly guarantee store approval because Google/Apple make the final review decision.
