# MiniPort — Google Play release preparation

Last reviewed: 2026-09-17

Read with `docs/store-compliance.md`. This file covers Android packaging only. Nothing here is a
guarantee of approval; Google makes the final decision.

## Current repository state (verified)

- MiniPort is a web application (TanStack Start). There is **no** Android project, Gradle files,
  manifest, signing config or generated AAB/APK in this repository. No store binary has been built.
- Installable-app metadata is now present and served:
  - `public/manifest.webmanifest` — name, short name, `standalone` display, portrait orientation,
    `#1B2A8A` theme colour, 192/512 icons plus a maskable 512 icon.
  - `public/icons/` — `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, and the 1024 master
    `miniport-icon-1024.png` for store listing / native icon generation.
  - `public/favicon.png` and the manifest/apple-touch-icon links in `src/routes/__root.tsx`.
- `capacitor.config.json` fixes the release identity so packaging cannot drift:
  - application ID **`app.miniport.faridabad`** (immutable once published — do not change it),
  - app name **MiniPort**, web output directory `dist/client`, HTTPS Android scheme,
    mixed content disabled.
- Production build passes (`bun run build`), types and lint clean.

## Wrapping for Play (must be run on a machine with the Android SDK)

Capacitor is not installed in this repository and the Android project cannot be generated or built
in this environment. On a development machine:

```bash
bun add -d @capacitor/cli && bun add @capacitor/core @capacitor/android
bun run build
bunx cap add android      # reads capacitor.config.json
bunx cap sync android
```

Then, in `android/app/build.gradle`:

- `compileSdk 36` and `targetSdk 36` — required for new and updated submissions from
  2026-08-31. `minSdk 23` or higher.
- `versionCode` must increase on every upload; `versionName` is the human version (start `1.0.0`).
- Configure a release signing config with an upload keystore kept outside the repository, and
  enrol in Play App Signing.

Build the bundle with `./gradlew bundleRelease` (produces `app-release.aab`).

## Permissions to declare in the native manifest

Only what the app actually uses:

- `INTERNET`
- `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` — foreground only. The app has **no**
  background location code, so do **not** add `ACCESS_BACKGROUND_LOCATION`; adding it triggers a
  prominent-disclosure review the app does not need.
- `CAMERA` and media read access — driver documents and proof-of-delivery photos.
- `POST_NOTIFICATIONS` — trip updates (Android 13+).

Do not add SMS or Call Log permissions: sign-up codes are delivered by the provider and entered
manually; autofill of codes is not implemented.

## Play Console work that cannot be done from code

- Developer account identity verification and payments profile.
- App signing enrolment and the upload key.
- Data safety form, completed from the shipped build and every bundled SDK: location, personal
  info, financial info, photos/files, auth info, device/notification identifiers, plus both
  deletion answers (in-app path **and** the public URL `/delete-account.html`).
- Privacy policy URL (`/privacy.html`) and account-deletion URL (`/delete-account.html`).
- Content rating questionnaire, category, store listing assets (feature graphic, screenshots).
- Reviewer access: working customer, driver and admin test logins with notes for booking,
  assignment, KYC, payment, location and cancellation. **SMS delivery must be live first** —
  without it a reviewer cannot receive a sign-up code and the app will be rejected as unusable.

## Known release blockers outside this repository

1. SMS provider credentials for sign-up verification codes (deferred integration).
2. Google Maps key authorised for the production origin (maps, geocoding, place imagery).
3. Payment provider live keys and the webhook signing secret.
4. Push notification production credentials.
5. Real privacy/support contact published on the privacy and deletion pages and in the listing.
6. The Android project itself, signing key, and a real-device GPS test through the wrapper.
