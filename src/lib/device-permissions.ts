/** Request MiniPort device permissions once after login.
 * Browsers/Android still require the user to explicitly allow each permission.
 * Camera/microphone tracks are stopped immediately after the permission prompt.
 */ 
export async function requestDevicePermissionsOnce(userId?: string): Promise<void> {
  if (typeof window === "undefined") return;
  const permissionKey = `miniport-device-permissions-requested:${userId ?? "guest"}`;
  if (window.localStorage.getItem(permissionKey) === "1") return;

  try {
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // Permission/device errors must never block login.
      }
    }

    if (navigator.geolocation) {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(),
          () => resolve(),
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
        );
      });
    }

    // Ask for push notification permission at the same post-login point.
    if ("Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Notification permission errors must never block login.
      }
    }
  } finally {
    window.localStorage.setItem(permissionKey, "1");
  }
}
