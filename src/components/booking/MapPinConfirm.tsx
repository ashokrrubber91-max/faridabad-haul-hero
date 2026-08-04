import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Home, Store, Bookmark, ArrowLeft, Crosshair, Check, MapPin } from "lucide-react";
import { loadGoogleMaps, FARIDABAD_CENTER } from "@/lib/google-maps";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { PlacePick } from "./LocationSearchOverlay";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "pickup" | "drop";
  initial: PlacePick | null;
  onConfirm: (p: PlacePick) => void;
}

const KINDS = [
  { id: "home" as const, label: "Home", icon: Home },
  { id: "shop" as const, label: "Shop / Company", icon: Store },
  { id: "other" as const, label: "Other", icon: Bookmark },
];

export function MapPinConfirm({ open, onOpenChange, mode, initial, onConfirm }: Props) {
  const { user, profile } = useAuth();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const initialRef = useRef<PlacePick | null>(initial);
  initialRef.current = initial;

  const [mapReady, setMapReady] = useState(false);
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pinSet, setPinSet] = useState(false);
  const [locating, setLocating] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [useMyPhone, setUseMyPhone] = useState(false);
  const [saveEnabled, setSaveEnabled] = useState(false);
  const [saveKind, setSaveKind] = useState<"home" | "shop" | "other">("other");
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset form each time the sheet opens. Saving is always opt-in (never auto-saves).
  useEffect(() => {
    if (!open) return;
    const init = initialRef.current;
    setAddress(init?.address ?? "");
    setCoords(init && init.lat && init.lng ? { lat: init.lat, lng: init.lng } : null);
    setPinSet(!!init?.address);
    setContactName(init?.contactName ?? "");
    setContactPhone(init?.contactPhone ?? "");
    setUseMyPhone(false);
    setSaveEnabled(false);
    setSaveKind("other");
    setAlias(init?.alias ?? "");
    setMapReady(false);
  }, [open]);

  // Build the map once per open, after the sheet has actually laid out its container.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let raf = 0;

    const start = async () => {
      const g = await loadGoogleMaps().catch(() => null);
      if (!g || cancelled) return;

      const waitForBox = () =>
        new Promise<HTMLDivElement | null>((resolve) => {
          const tick = (tries: number) => {
            if (cancelled) return resolve(null);
            const el = mapRef.current;
            if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return resolve(el);
            if (tries > 60) return resolve(el ?? null);
            raf = requestAnimationFrame(() => tick(tries + 1));
          };
          tick(0);
        });

      const el = await waitForBox();
      if (!el || cancelled) return;

      const init = initialRef.current;
      const center = {
        lat: init?.lat || FARIDABAD_CENTER.lat,
        lng: init?.lng || FARIDABAD_CENTER.lng,
      };

      const map = new g.maps.Map(el, {
        center,
        zoom: 16,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
      });
      mapInstance.current = map;
      geocoderRef.current = new g.maps.Geocoder();
      markerRef.current = new g.maps.Marker({ position: center, map, draggable: true });

      g.maps.event.addListenerOnce(map, "idle", () => {
        if (!cancelled) setMapReady(true);
      });
      // Belt-and-braces: force a relayout once the open animation finishes.
      setTimeout(() => {
        if (cancelled || !mapInstance.current) return;
        g.maps.event.trigger(mapInstance.current, "resize");
        mapInstance.current.setCenter(markerRef.current?.getPosition() ?? center);
        setMapReady(true);
      }, 400);

      const movePin = (lat: number, lng: number) => {
        markerRef.current?.setPosition({ lat, lng });
        setCoords({ lat, lng });
        setPinSet(false);
      };

      markerRef.current.addListener("dragend", () => {
        const pos = markerRef.current?.getPosition();
        if (pos) movePin(pos.lat(), pos.lng());
      });
      map.addListener("click", (ev: google.maps.MapMouseEvent) => {
        const ll = ev.latLng;
        if (ll) movePin(ll.lat(), ll.lng());
      });
    };

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      mapInstance.current = null;
      markerRef.current = null;
      geocoderRef.current = null;
    };
  }, [open]);

  const setLocationFromPin = async () => {
    const pos = markerRef.current?.getPosition();
    const lat = pos?.lat() ?? coords?.lat;
    const lng = pos?.lng() ?? coords?.lng;
    if (lat == null || lng == null) return toast.error("Move the pin on the map first");
    setLocating(true);
    setCoords({ lat, lng });
    try {
      const res = await geocoderRef.current?.geocode({ location: { lat, lng } });
      if (res?.results[0]) setAddress(res.results[0].formatted_address);
    } catch {
      /* keep whatever address we have */
    } finally {
      setLocating(false);
      setPinSet(true);
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return toast.error("Location not available");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        markerRef.current?.setPosition({ lat, lng });
        mapInstance.current?.panTo({ lat, lng });
        setCoords({ lat, lng });
        setPinSet(false);
      },
      () => toast.error("Could not fetch your location"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  useEffect(() => {
    if (useMyPhone && profile?.phone) setContactPhone(profile.phone);
  }, [useMyPhone, profile]);

  const handleConfirm = async () => {
    if (!coords || !address || !pinSet) {
      toast.error("Tap “Set location” to confirm the pin");
      return;
    }
    if (!contactName.trim() || !contactPhone.trim()) {
      toast.error(`Enter ${mode === "pickup" ? "sender" : "receiver"} name and mobile`);
      return;
    }
    setSaving(true);
    try {
      if (saveEnabled && user) {
        const { error } = await supabase.from("saved_addresses").insert({
          user_id: user.id,
          kind: saveKind,
          alias: alias.trim() || null,
          address,
          latitude: coords.lat,
          longitude: coords.lng,
          place_id: initialRef.current?.placeId ?? null,
          contact_name: contactName.trim(),
          contact_phone: contactPhone.trim(),
        });
        if (error) throw error;
        toast.success("Address saved");
      }
      onConfirm({
        address,
        lat: coords.lat,
        lng: coords.lng,
        placeId: initialRef.current?.placeId,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        alias: alias.trim() || undefined,
        kind: saveEnabled ? saveKind : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const personLabel = mode === "pickup" ? "Sender" : "Receiver";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[100dvh] w-full max-w-full p-0 sm:max-w-full">
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-2 border-b bg-background px-4 py-3">
            <button onClick={() => onOpenChange(false)} aria-label="Back" className="p-1">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <p className="font-display text-lg tracking-wide text-secondary">
              Confirm {mode === "pickup" ? "pickup" : "drop"}
            </p>
          </header>

          <div className="relative w-full shrink-0" style={{ height: 320 }}>
            <div ref={mapRef} className="absolute inset-0 h-full w-full bg-muted" />
            {!mapReady && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-muted">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={useCurrentLocation}
              className="absolute bottom-3 right-3 shadow-md"
            >
              <Crosshair className="mr-1.5 h-4 w-4" /> Use my location
            </Button>
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-[11px] font-medium text-secondary shadow-sm">
              Drag the pin or tap the map, then set the location
            </div>
          </div>

          <div className="border-b bg-background p-3">
            <Button
              type="button"
              variant={pinSet ? "secondary" : "default"}
              onClick={setLocationFromPin}
              disabled={locating}
              className="h-11 w-full"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : pinSet ? (
                <>
                  <Check className="mr-1.5 h-4 w-4" /> Location set
                </>
              ) : (
                <>
                  <MapPin className="mr-1.5 h-4 w-4" /> Set location
                </>
              )}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="surface-card p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Address</p>
              <p className="mt-1 text-sm font-medium text-secondary">
                {pinSet && address ? address : "Drag the pin and tap “Set location”"}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <Label htmlFor="cname">{personLabel}'s name</Label>
                <Input
                  id="cname"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder={`${personLabel}'s full name`}
                  maxLength={80}
                />
              </div>
              <div>
                <Label htmlFor="cphone">{personLabel}'s mobile number</Label>
                <Input
                  id="cphone"
                  inputMode="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="10-digit mobile"
                  maxLength={15}
                  disabled={useMyPhone}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={useMyPhone} onCheckedChange={(v) => setUseMyPhone(v === true)} />
                Use my mobile number
              </label>
            </div>

            <div className="mt-5 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-secondary">Save this address</p>
                  <p className="text-xs text-muted-foreground">Off by default — nothing is stored unless you turn this on.</p>
                </div>
                <Switch checked={saveEnabled} onCheckedChange={setSaveEnabled} aria-label="Save this address" />
              </div>

              {saveEnabled && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    {KINDS.map((k) => {
                      const Icon = k.icon;
                      const active = saveKind === k.id;
                      return (
                        <button
                          key={k.id}
                          type="button"
                          onClick={() => setSaveKind(k.id)}
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                            active
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-secondary hover:bg-muted"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {k.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2">
                    <Label htmlFor="alias">Label (optional)</Label>
                    <Input
                      id="alias"
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                      placeholder="e.g. Radha Rubber Industries"
                      maxLength={80}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <footer className="border-t bg-background p-3">
            <Button onClick={handleConfirm} disabled={saving || !pinSet} className="h-11 w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirm ${mode === "pickup" ? "pickup" : "drop"}`}
            </Button>
          </footer>
        </div>
      </SheetContent>
    </Sheet>
  );
}
