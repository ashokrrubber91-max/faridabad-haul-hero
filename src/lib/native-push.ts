import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/error-logger";

type NativePushPlugin = {
  checkPermissions?: () => Promise<{ receive?: string }>;
  requestPermissions?: () => Promise<{ receive?: string }>;
  register?: () => Promise<void>;
  createChannel?: (channel: Record<string, unknown>) => Promise<void>;
  addListener?: (event: string, callback: (payload: any) => void) => Promise<{ remove?: () => Promise<void> | void }>;
};

async function importNative(name: string): Promise<Record<string, any> | null> {
  try {
    const importer = new Function("name", "return import(name)") as (name: string) => Promise<Record<string, any>>;
    return await importer(name);
  } catch {
    return null;
  }
}

export async function registerNativePushForUser(userId: string): Promise<() => void> {
  if (typeof window === "undefined" || !window.Capacitor?.isNativePlatform?.()) {
    return () => undefined;
  }

  const mod = await importNative("@capacitor/push-notifications");
  const push = (mod?.PushNotifications as NativePushPlugin | undefined) ?? null;
  if (!push?.register || !push.requestPermissions) return () => undefined;

  const cleanups: Array<() => void> = [];

  try {
    await push.createChannel?.({
      id: "miniport-trips",
      name: "MiniPort trips",
      description: "New ride assignments and live trip updates",
      importance: 5,
      sound: "default",
      vibration: true,
    });

    const registration = await push.addListener?.("registration", async (token: { value?: string }) => {
      const value = token?.value?.trim();
      if (!value) return;
      const { error } = await supabase.from("device_tokens").upsert(
        {
          user_id: userId,
          token: value,
          platform: "android",
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "token" },
      );
      if (error) logError(error, { source: "supabase", action: "save-native-push-token" });
    });
    if (registration) cleanups.push(() => void registration.remove?.());

    const registrationError = await push.addListener?.("registrationError", (error: unknown) => {
      logError(error, { source: "runtime", action: "native-push-registration" });
    });
    if (registrationError) cleanups.push(() => void registrationError.remove?.());

    const received = await push.addListener?.("pushNotificationReceived", (notification: unknown) => {
      // The native Push Notifications plugin handles the Android heads-up/sound
      // presentation. This listener is for app-side refreshes/observability.
      window.dispatchEvent(new CustomEvent("miniport:push-received", { detail: notification }));
    });
    if (received) cleanups.push(() => void received.remove?.());

    const action = await push.addListener?.("pushNotificationActionPerformed", (notification: unknown) => {
      window.dispatchEvent(new CustomEvent("miniport:push-action", { detail: notification }));
    });
    if (action) cleanups.push(() => void action.remove?.());

    let permissions = await push.checkPermissions?.();
    if (permissions?.receive === "prompt") {
      permissions = await push.requestPermissions();
    }
    if (permissions?.receive !== "granted") {
      logError(new Error("Native push permission was not granted"), {
        source: "runtime",
        action: "native-push-permission",
      });
      return () => cleanups.forEach((fn) => fn());
    }

    await push.register();
  } catch (error) {
    logError(error, { source: "runtime", action: "native-push-register" });
  }

  return () => cleanups.forEach((fn) => fn());
}
