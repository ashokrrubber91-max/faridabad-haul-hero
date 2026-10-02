/**
 * Optional Capacitor bridge.
 *
 * The web build intentionally does not hard-import native plugins, so the PWA
 * remains dependency-safe. A native Capacitor build can install the official
 * plugins listed in docs/capacitor-native.md; this bridge dynamically loads
 * them at runtime and falls back to browser APIs when they are unavailable.
 */
export type NativePermissionState = "granted" | "prompt" | "prompt-with-rationale" | "denied";

type NativeRuntime = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};
\n
const getRuntime = (): NativeRuntime | null =>
  typeof window !== "undefined" ? (window.Capacitor ?? null) : null;

export function isNativeCapacitor(): boolean {
  const runtime = getRuntime();
  return !!runtime?.isNativePlatform?.();
}

/**
 * Uses a runtime dynamic import so the PWA build does not require native
 * Capacitor packages. Native builds should install the official plugins first.
 */
export async function loadNativePlugin<T>(
  packageName: string,
  exportName: string,
  pluginName: string,
): Promise<T | null> {
  if (!isNativeCapacitor()) return null;

  try {
    const runtime = getRuntime();
    const available = runtime?.isPluginAvailable?.(pluginName);
    if (available === false) return null;

    const dynamicImport = new Function(
      "moduleName",
      "return import(moduleName)",
    ) as (moduleName: string) => Promise<Record<string, unknown>>;
    const mod = await dynamicImport(packageName);
    return (mod[exportName] as T | undefined) ?? null;
  } catch {
    return null;
  }
}
