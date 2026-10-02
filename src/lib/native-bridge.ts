/**
 * Optional Capacitor bridge.
 *
 * MiniPort stays fully functional on the web/PWA. When the app is wrapped by
 * Capacitor and the official native plugins are installed, these helpers use
 * the native permission/location APIs; otherwise they return null and the
 * caller falls back to browser APIs.
 */
export type NativePosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  };
  timestamp?: number;
};

type PermissionResult = { location?: string; camera?: string; notifications?: string };

type CapacitorPlugin = {
  checkPermissions?: () => Promise<PermissionResult>;
  requestPermissions?: () => Promise<PermissionResult>;
  getCurrentPosition?: (options?: Record<string, unknown>) => Promise<NativePosition>;
  watchPosition?: (
    options: Record<string, unknown>,
    callback: (position: NativePosition | null, err?: unknown) => void,
  ) => Promise<string>;
  clearWatch?: (options: { id: string }) => Promise<void>;
};

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, CapacitorPlugin | undefined>;
};

declare global {
  interface Window {
    Capacitor?: CapacitorBridge;
  }
}

export function getCapacitorPlugin(name: string): CapacitorPlugin | null {
  if (typeof window === "undefined") return null;
  const capacitor = window.Capacitor;
  if (!capacitor) return null;
  if (capacitor.isNativePlatform && !capacitor.isNativePlatform()) return null;
  if (capacitor.isPluginAvailable && !capacitor.isPluginAvailable(name)) return null;
  return capacitor.Plugins?.[name] ?? null;
}

export function isNativeCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

export async function requestNativePermission(
  pluginName: "Camera" | "Geolocation" | "PushNotifications",
): Promise<"granted" | "denied" | "unsupported"> {
  const plugin = getCapacitorPlugin(pluginName);
  if (!plugin?.requestPermissions) return "unsupported";
  try {
    const result = await plugin.requestPermissions();
    const values = Object.values(result ?? {});
    return values.length === 0 || values.every((value) => value === "granted")
      ? "granted"
      : "denied";
  } catch {
    return "denied";
  }
}

export async function nativeGeolocationPermission(): Promise<
  "granted" | "prompt" | "denied" | "unknown"
> {
  const plugin = getCapacitorPlugin("Geolocation");
  if (!plugin?.checkPermissions) return "unknown";
  try {
    const result = await plugin.checkPermissions();
    const state = result.location;
    if (state === "granted") return "granted";
    if (state === "denied") return "denied";
    if (state === "prompt" || state === "prompt-with-rationale") return "prompt";
  } catch {
    // Fall through to browser permission state.
  }
  return "unknown";
}

export async function getNativeCurrentPosition(
  options: PositionOptions,
): Promise<NativePosition | null> {
  const plugin = getCapacitorPlugin("Geolocation");
  if (!plugin?.getCurrentPosition) return null;
  const permission = await nativeGeolocationPermission();
  if (permission === "denied") throw new Error("NATIVE_LOCATION_DENIED");
  if (permission !== "granted") {
    const requested = await requestNativePermission("Geolocation");
    if (requested !== "granted") throw new Error("NATIVE_LOCATION_DENIED");
  }
  return plugin.getCurrentPosition({
    enableHighAccuracy: options.enableHighAccuracy,
    timeout: options.timeout,
    maximumAge: options.maximumAge,
  });
}

export async function watchNativePosition(
  options: PositionOptions,
  callback: (position: NativePosition | null, error?: unknown) => void,
): Promise<string | null> {
  const plugin = getCapacitorPlugin("Geolocation");
  if (!plugin?.watchPosition) return null;
  const permission = await nativeGeolocationPermission();
  if (permission !== "granted") {
    const requested = await requestNativePermission("Geolocation");
    if (requested !== "granted") {
      callback(null, new Error("NATIVE_LOCATION_DENIED"));
      return null;
    }
  }
  return plugin.watchPosition(
    {
      enableHighAccuracy: options.enableHighAccuracy,
      timeout: options.timeout,
      maximumAge: options.maximumAge,
    },
    callback,
  );
}

export async function clearNativeWatch(id: string | null): Promise<void> {
  if (!id) return;
  const plugin = getCapacitorPlugin("Geolocation");
  if (!plugin?.clearWatch) return;
  await plugin.clearWatch({ id });
}
