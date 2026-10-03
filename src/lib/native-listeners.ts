import { registerNativePushForUser } from "@/lib/native-push";
import { installNativeAppPolish } from "@/lib/native-app";

/**
 * Installs the two native listeners MiniPort needs after authentication:
 * - Android/iOS push registration + device token persistence
 * - native Android back-button handling
 *
 * Web/PWA builds are safe because both underlying bridges no-op outside Capacitor.
 */
export async function installNativeListeners(options: {
  userId: string;
  onBack: () => void;
}): Promise<() => void> {
  const cleanups: Array<() => void> = [];

  const disposeApp = await installNativeAppPolish(options.onBack);
  cleanups.push(disposeApp);

  const disposePush = await registerNativePushForUser(options.userId);
  cleanups.push(disposePush);

  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
