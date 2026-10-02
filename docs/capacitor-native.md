# MiniPort Capacitor native build

The web/PWA code is already runtime-safe: it uses the browser APIs in a normal browser/PWA and the optional native bridge when Capacitor plugins are available.

## One-time native dependency setup

From the MiniPort repository, install the official Capacitor 8 packages:

```bash
bun add @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
bun add @capacitor/geolocation @capacitor/camera @capacitor/local-notifications
```

Then create/sync the native projects:

```bash
bunx cap add android
bunx cap add ios
bunx cap sync
```

Do **not** add these packages to the web-only build unless you are preparing the native projects; the current repository intentionally keeps the PWA dependency graph light.

## Android permissions

The official Geolocation plugin requests both `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` when the `location` permission is requested. Camera and Local Notifications similarly provide their native permission APIs.

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
