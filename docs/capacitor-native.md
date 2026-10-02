# MiniPort Capacitor native build

MiniPort is web-first but already contains a Capacitor-safe native bridge for Android/iOS permissions, push notifications, local notifications, status-bar styling and Android back-button handling. The repository intentionally does not commit generated android/ or ios/ projects or native dependency lock entries.

## One-time native dependency setup

From the MiniPort repository, install the official Capacitor 8 packages:

```bash
bun add @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
bun add @capacitor/app @capacitor/status-bar
bun add @capacitor/geolocation @capacitor/camera @capacitor/local-notifications @capacitor/push-notifications
```

Then create/sync the native projects:

```bash
bunx cap add android
bunx cap add ios
bunx cap sync
```

The dynamic native bridge keeps the normal browser/PWA bundle usable before these packages are installed. Do not commit generated native folders unless the team decides to maintain native projects in-repo.

## Android permissions

The generated Android project should contain only permissions required by the installed plugins and actual features: ACCESS_COARSE_LOCATION and ACCESS_FINE_LOCATION for location, CAMERA for driver KYC/POD capture, and POST_NOTIFICATIONS on Android 13+ for trip alerts. Do not add ACCESS_BACKGROUND_LOCATION unless a future release implements and discloses true background location tracking.

For the generated Android project, verify the merged manifest contains:

- `android.permission.ACCESS_COARSE_LOCATION`
- `android.permission.ACCESS_FINE_LOCATION`
- `android.permission.CAMERA`
- `android.permission.POST_NOTIFICATIONS` (Android 13+)

The app asks for permissions once after successful login. A browser/PWA uses the corresponding Web APIs instead.

## Location behavior

- Native Capacitor + Geolocation plugin: native GPS permission/check/request + native `getCurrentPosition/watchPosition`.
- PWA/browser: HTML5 `navigator.geolocation`.
- If the native plugin is unavailable or cannot produce a fix, MiniPort falls back to the browser API.
- No fake coordinates are ever generated.

## Notifications

Local Notifications are configured in `capacitor.config.json` with the MiniPort notification icon/color. Android 13+ requires the runtime notification permission.

## Build checks

Before opening Android Studio:

```bash
bun run typecheck
bun run lint
bun run build
bunx cap sync android
```

Then open Android Studio with:

```bash
bunx cap open android
```

The Capacitor configuration uses app id `app.miniport.faridabad`, app name `MiniPort`, HTTPS Android scheme, and `dist/client` as the web output directory.


## Push + Android back button

After login, the native push bridge requests notification permission, registers the FCM/APNs token, stores it through the authenticated server function in device_tokens, and uses the miniport-trips Android channel for heads-up sound/vibration. Configure Firebase/FCM credentials in the native Android project before production release.

The authenticated layout installs the native App.addListener("backButton") handler. It closes the top-most dialog/drawer first, then navigates back through history. The root viewport already uses viewport-fit=cover and authenticated pages apply env(safe-area-inset-top). Status-bar styling is #1E293B.

## Signed AAB checklist

On the native development machine:

```bash
bun run typecheck
bun run lint
bun run build
bunx cap sync android
bunx cap open android
```

In Android Studio, confirm application ID app.miniport.faridabad, configure a private release/upload keystore outside Git, build a signed Android App Bundle, and increase versionCode for every release.
