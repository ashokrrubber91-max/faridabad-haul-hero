import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getPushConfig, registerDeviceToken } from "@/lib/push.functions";

const STORAGE_KEY = "miniport.push.token";

type PushState = "unsupported" | "idle" | "enabling" | "enabled" | "denied";

function browserSupportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/**
 * Registers this device with Firebase Cloud Messaging so ride alerts arrive even
 * when the app is closed. Everything runs in the browser after a user gesture.
 */
export function usePushNotifications() {
  const [state, setState] = useState<PushState>("idle");

  useEffect(() => {
    if (!browserSupportsPush()) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") setState("denied");
    else if (Notification.permission === "granted" && localStorage.getItem(STORAGE_KEY)) {
      setState("enabled");
    }
  }, []);

  const enable = useCallback(async () => {
    if (!browserSupportsPush()) {
      toast.error("This browser cannot show background alerts. Use Chrome on Android or desktop.");
      return;
    }
    setState("enabling");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        toast.error("Notifications blocked. Allow them in your browser settings to get ride alerts.");
        return;
      }

      const push = await getPushConfig();
      if (!push.configured) {
        setState("idle");
        toast.error("Push notifications are not configured yet.");
        return;
      }

      const query = new URLSearchParams(
        Object.entries(push.config).filter(([, v]) => !!v) as [string, string][],
      ).toString();
      const registration = await navigator.serviceWorker.register(
        `/firebase-messaging-sw.js?${query}`,
        { scope: "/" },
      );
      await navigator.serviceWorker.ready;

      const [{ initializeApp, getApps, getApp }, { getMessaging, getToken, onMessage }] =
        await Promise.all([import("firebase/app"), import("firebase/messaging")]);

      const app = getApps().length > 0 ? getApp() : initializeApp(push.config);
      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
        vapidKey: push.vapidKey,
        serviceWorkerRegistration: registration,
      });
      if (!token) throw new Error("Could not create a device token");

      await registerDeviceToken({ data: { token, platform: "web" } });
      localStorage.setItem(STORAGE_KEY, token);

      onMessage(messaging, (payload) => {
        toast.info(payload.notification?.title ?? "New update", {
          description: payload.notification?.body,
        });
      });

      setState("enabled");
      toast.success("Ride alerts are on for this device");
    } catch (error) {
      setState("idle");
      toast.error(error instanceof Error ? error.message : "Could not turn on alerts");
    }
  }, []);

  return { state, enable, supported: state !== "unsupported" };
}
