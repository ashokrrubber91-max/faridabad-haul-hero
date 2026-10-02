import { registerDeviceToken } from "@/lib/push.functions";
import { logError } from "@/lib/error-logger";

type NativePushPlugin = {
  checkPermissions?: () => Promise<{ receive?: string }>;
  requestPermissions?: () => Promise<{ receive?: string }>;
  register?: () => Promise<void>;
  createChannel?: (channel: Record<string, unknown>) => Promise<void>;
  addListener?: (
    event: string,
    callback: (payload: any) => void,
  ) => Promise<{ remove?: () => Promise<void> | void }>;
};

type LocalNotificationsPlugin = {
  schedule?: (options: Record<string, unknown>) => Promise<unknown>;
  createChannel?: (channel: Record<string, unknown>) => Promise<void>;
};

async function importNative(name: string): Promise<Record<string, any> | null> {
  try {
    const importer = new Function("name", "return import(name)") as (
      name: string,
    ) => Promise<Record<string, any>>;
    return await importer(name);
  } catch {
    return null;
  }
}

function nativePlatform(): "android" | "ios" {
  return /android/i.test(navigator.userAgent) ? "android" : "ios";
}

/**
 * Registers the native FCM token after login and keeps native trip alerts alive.
 * Android channel importance/sound is configured for heads-up ride alerts.
 */
export async function registerNativePushForUser(userId: string): Promise<() => void> {
  if (typeof window === "undefined" || !window.Capacitor?.isNativePlatform?.()) {
    return () => undefined;
  }

  const mod = await importNative("@capacitor/push-notifications");
  const localMod = await importNative("@capacitor/local-notifications");
  const push = (mod?.PushNotifications as NativePushPlugin | undefined) ?? null;
  const local =
    (localMod?.LocalNotifications as LocalNotificationsPlugin | undefined) ?? null;

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
      lights: true,
    });
    await local?.createChannel?.({
      id: "miniport-trips",
      name: "MiniPort trips",
      description: "New ride assignments and live trip updates",
      importance: 5,
      sound: "default",
      vibration: true,
    });

    const registration = await push.addListener?.(
      "registration",
      async (token: { value?: string }) => {
        const value = token?.value?.trim();
        if (!value) return;
        try {
          await registerDeviceToken({
            data: { token: value, platform: nativePlatform() },
          });
        } catch (error) {
          logError(error, {
            source: "supabase",
            action: "save-native-push-token",
          });
        }
      },
    );
    if (registration) cleanups.push(() => void registration.remove?.());

    const registrationError = await push.addListener?.(
      "registrationError",
      (error: unknown) => {
        logError(error, {
          source: "runtime",
          action: "native-push-registration",
        });
      },
    );
    if (registrationError) cleanups.push(() => void registrationError.remove?.());

    const received = await push.addListener?.(
      "pushNotificationReceived",
      async (notification: {
        id?: string;
        title?: string;
        body?: string;
        data?: Record<string, unknown>;
      }) => {
        window.dispatchEvent(
          new CustomEvent("miniport:push-received", { detail: notification }),
        );

        // Native push plugins normally show background notifications themselves.
        // When the app is foregrounded, mirror the event into a local heads-up
        // notification so new rides/status changes still produce sound + vibration.
        try {
          await local?.schedule?.({
            notifications: [
              {
                id: Math.abs(
                  Array.from(notification.id ?? String(Date.now()))
                    .reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) | 0, 7),
                ),
                title: notification.title ?? "MiniPort",
                body: notification.body ?? "You have a new trip update.",
                channelId: "miniport-trips",
                sound: "default",
                schedule: { at: new Date(Date.now() + 250) },
                extra: notification.data ?? {},
              },
            ],
          });
        } catch (error) {
          logError(error, {
            source: "runtime",
            action: "native-push-foreground-notification",
          });
        }
      },
    );
    if (received) cleanups.push(() => void received.remove?.());

    const action = await push.addListener?.(
      "pushNotificationActionPerformed",
      (notification: unknown) => {
        window.dispatchEvent(
          new CustomEvent("miniport:push-action", { detail: notification }),
        );
      },
    );
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
