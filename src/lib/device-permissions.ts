/** Request the device permissions MiniPort needs once after login.
 * Browsers still require the user to explicitly allow each permission.
 * We stop media tracks immediately so the camera/microphone are not left active.
 */
export async function requestDevicePermissionsOnce(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem("miniport-device-permissions-requested") === "1") return;

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
  } finally {
    window.localStorage.setItem("miniport-device-permissions-requested", "1");
  }
}
