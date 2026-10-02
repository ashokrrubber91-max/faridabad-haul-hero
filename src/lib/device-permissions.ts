import { requestNativePermission } from "@/lib/native-bridge";
/** One-time device permission onboarding. Real browser prompts only — never faked. */
export type PermissionKey = "location" | "camera" | "microphone" | "notifications";
export type PermissionOutcome = "granted" | "denied" | "unsupported";
export type PermissionRecord = Partial<Record<PermissionKey, PermissionOutcome>>;

export const PERMISSIONS: Array<{
  key: PermissionKey;
  label: string;
  reason: string;
  driverReason: string;
}> = [
  {
    key: "location",
    label: "Location",
    reason: "Find your pickup point faster.",
    driverReason: "Needed to go online, receive nearby rides and share live trip location.",
  },
  {
    key: "camera",
    label: "Camera",
    reason: "Upload photos for support when needed.",
    driverReason: "Capture KYC documents and delivery photos.",
  },
  {
    key: "microphone",
    label: "Microphone",
    reason: "Voice support and calls.",
    driverReason: "Voice support and calls with customers.",
  },
  {
    key: "notifications",
    label: "Notifications",
    reason: "Trip updates and driver arrival alerts.",
    driverReason: "New ride alerts and trip updates.",
  },
];

const recordKey = (u: string) => `miniport-permissions:${u}`;
const doneKey = (u: string) => `miniport-permissions-done:${u}`;

export function loadPermissionRecord(userId: string): PermissionRecord {
  try {
    return JSON.parse(window.localStorage.getItem(recordKey(userId)) ?? "{}");
  } catch {
    return {};
  }
}
export function savePermissionRecord(userId: string, r: PermissionRecord) {
  window.localStorage.setItem(recordKey(userId), JSON.stringify(r));
}
export function permissionFlowDone(userId: string): boolean {
  return window.localStorage.getItem(doneKey(userId)) === "1";
}
export function markPermissionFlowDone(userId: string) {
  window.localStorage.setItem(doneKey(userId), "1");
}

export async function requestPermission(key: PermissionKey): Promise<PermissionOutcome> {
  try {
    if (key === "location") {
      const native = await requestNativePermission("Geolocation");
      if (native !== "unsupported") return native;
      if (!navigator.geolocation) return "unsupported";
      return await new Promise((resolve) =>
        navigator.geolocation.getCurrentPosition(
          () => resolve("granted"),
          // Timeout/unavailable still means permission was granted.
          (e) => resolve(e.code === e.PERMISSION_DENIED ? "denied" : "granted"),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        ),
      );
    }
    if (key === "camera" || key === "microphone") {
      if (key === "camera") {
        const native = await requestNativePermission("Camera");
        if (native !== "unsupported") return native;
      }
      if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          key === "camera" ? { video: true } : { audio: true },
        );
        stream.getTracks().forEach((t) => t.stop());
        return "granted";
      } catch (e) {
        const name = (e as DOMException)?.name;
        return name === "NotFoundError" || name === "OverconstrainedError"
          ? "unsupported"
          : "denied";
      }
    }
    if (!("Notification" in window)) return "unsupported";
    const nativeNotifications = await requestNativePermission("LocalNotifications");
    const pushNotifications = nativeNotifications === "unsupported"
      ? await requestNativePermission("PushNotifications")
      : nativeNotifications;
    if (pushNotifications !== "unsupported") return pushNotifications;
    const p =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    return p === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}


/** Ask for the app's requested device permissions once after a successful login. */
export async function requestDevicePermissionsOnce(userId: string): Promise<void> {
  if (typeof window === "undefined" || permissionFlowDone(userId)) return;

  const record = loadPermissionRecord(userId);
  for (const permission of PERMISSIONS) {
    if (record[permission.key]) continue;
    const outcome = await requestPermission(permission.key);
    record[permission.key] = outcome;
    savePermissionRecord(userId, record);
  }

  markPermissionFlowDone(userId);
}
