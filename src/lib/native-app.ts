import { logError } from "@/lib/error-logger";

type ListenerHandle = { remove?: () => Promise<void> | void };

async function importNative(name: string): Promise<Record<string, any> | null> {
  try {
    const importer = new Function("name", "return import(name)") as (name: string) => Promise<Record<string, any>>;
    return await importer(name);
  } catch {
    return null;
  }
}

/**
 * Native-only Android/iOS polish. The web app remains fully functional when
 * Capacitor plugins are not present (for example, in the browser/PWA).
 */
export async function installNativeAppPolish(onBack: () => void): Promise<() => void> {
  if (typeof window === "undefined" || !window.Capacitor?.isNativePlatform?.()) {
    return () => undefined;
  }

  const cleanup: Array<() => void> = [];

  try {
    const appModule = await importNative("@capacitor/app");
    const app = appModule?.App as {
      addListener?: (event: string, cb: () => void) => Promise<ListenerHandle>;
    } | undefined;

    if (app?.addListener) {
      const handle = await app.addListener("backButton", () => {
        // Let open dialogs/drawers consume the normal Escape semantics first.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        window.setTimeout(() => {
          if (document.querySelector('[role="dialog"][data-state="open"]')) return;
          onBack();
        }, 30);
      });
      cleanup.push(() => void handle?.remove?.());
    }
  } catch (error) {
    logError(error, { source: "runtime", action: "native-back-button" });
  }

  try {
    const statusModule = await importNative("@capacitor/status-bar");
    const statusBar = statusModule?.StatusBar as {
      setStyle?: (options: { style: string }) => Promise<void>;
      setBackgroundColor?: (options: { color: string }) => Promise<void>;
    } | undefined;

    await statusBar?.setStyle?.({ style: "LIGHT" });
    // Works on supported Android versions; Android 15/16+ edge-to-edge may
    // ignore backgroundColor, so CSS safe-area handling remains the fallback.
    await statusBar?.setBackgroundColor?.({ color: "#1E293B" });
  } catch (error) {
    logError(error, { source: "runtime", action: "native-status-bar" });
  }

  return () => cleanup.forEach((fn) => fn());
}
