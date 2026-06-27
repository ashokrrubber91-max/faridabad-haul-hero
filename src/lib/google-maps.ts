// Google Maps JS API loader (singleton) using the Lovable-managed browser key.
// Loads Places library on demand via importLibrary.

let loadPromise: Promise<typeof google> | null = null;

declare global {
  interface Window {
    google: typeof google;
    __miniportMapsInit?: () => void;
  }
}

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loadPromise) return loadPromise;

  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
  if (!key) return Promise.reject(new Error("Google Maps browser key missing"));

  loadPromise = new Promise((resolve, reject) => {
    window.__miniportMapsInit = () => resolve(window.google);
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key,
      v: "weekly",
      libraries: "places,marker",
      loading: "async",
      callback: "__miniportMapsInit",
    });
    if (channel) params.set("channel", channel);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
  return loadPromise;
}

export const FARIDABAD_CENTER = { lat: 28.4089, lng: 77.3178 };
export const FARIDABAD_BOUNDS = {
  low: { latitude: 28.30, longitude: 77.20 },
  high: { latitude: 28.55, longitude: 77.45 },
};
