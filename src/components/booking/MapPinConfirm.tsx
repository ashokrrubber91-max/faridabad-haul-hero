import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Home, Store, Bookmark, ArrowLeft, Crosshair } from "lucide-react";
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

  const [address, setAddress] = useState(initial?.address ?? "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initial ? { lat: initial.lat, lng: initial.lng } : null,
  );
  const [contactName, setContactName] = useState(initial?.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? "");
  const [useMyPhone, setUseMyPhone] = useState(false);
  const [saveKind, setSaveKind] = useState<"home" | "shop" | "other" | null>(initial?.kind ?? null);
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAddress(initial?.address ?? "");
    setCoords(initial ? { lat: initial.lat, lng: initial.lng } : null);
    setContactName(initial?.contactName ?? "");
    setContactPhone(initial?.contactPhone ?? "");
    setUseMyPhone(false);
    setSaveKind(initial?.kind ?? null);
    setAlias(initial?.alias ?? "");
  }, [open, initial]);

  useEffect(() => {
    if (!open || !initial || !mapRef.current) return;
    let cancelled = false;
    loadGoogleMaps().then((g) => {
      if (cancelled || !mapRef.current) return;
      const center = { lat: initial.lat, lng: initial.lng };
      mapInstance.current = new g.maps.Map(mapRef.current, {
        center,
        zoom: 16,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
      });
      markerRef.current = new g.maps.Marker({
        position: center,
        map: mapInstance.current,
        draggable: true,
      });
      geocoderRef.current = new g.maps.Geocoder();
      markerRef.current.addListener("dragend", async () => {
        const pos = markerRef.current?.getPosition();
        if (!pos) return;
        const lat = pos.lat();
        const lng = pos.lng();
        setCoords({ lat, lng });
        try {
          const res = await geocoderRef.current!.geocode({ location: { lat, lng } });
          if (res.results[0]) setAddress(res.results[0].formatted_address);
        } catch {
          /* ignore */
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, initial]);

  useEffect(() => {
    if (useMyPhone && profile?.phone) setContactPhone(profile.phone);
  }, [useMyPhone, profile]);

  const handleConfirm = async () => {
    if (!coords || !address) {
      toast.error("Pick a location on the map");
      return;
    }
    if (!contactName.trim() || !contactPhone.trim()) {
      toast.error(`Enter ${mode === "pickup" ? "sender" : "receiver"} name and mobile`);
      return;
    }
    setSaving(true);
    try {
      if (saveKind && user) {
        const { error } = await supabase.from("saved_addresses").insert({
          user_id: user.id,
          kind: saveKind,
          alias: saveKind === "shop" ? alias.trim() || null : null,
          address,
          latitude: coords.lat,
          longitude: coords.lng,
          place_id: initial?.placeId ?? null,
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
        placeId: initial?.placeId,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        alias: alias.trim() || undefined,
        kind: saveKind ?? undefined,
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

          <div ref={mapRef} className="h-[42vh] w-full bg-muted" />

          <div className="flex-1 overflow-y-auto p-4">
            <div className="surface-card p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Address</p>
              <p className="mt-1 text-sm font-medium text-secondary">{address || "Drag the pin to set location"}</p>
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
                <Checkbox
                  checked={useMyPhone}
                  onCheckedChange={(v) => setUseMyPhone(v === true)}
                />
                Use my mobile number
              </label>
            </div>

            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Save this address (optional)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {KINDS.map((k) => {
                  const Icon = k.icon;
                  const active = saveKind === k.id;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setSaveKind(active ? null : k.id)}
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
              {saveKind === "shop" && (
                <div className="mt-2">
                  <Label htmlFor="alias">Company / Shop name</Label>
                  <Input
                    id="alias"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    placeholder="e.g. Radha Rubber Industries"
                    maxLength={80}
                  />
                </div>
              )}
            </div>
          </div>

          <footer className="border-t bg-background p-3">
            <Button onClick={handleConfirm} disabled={saving} className="h-11 w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirm ${mode === "pickup" ? "pickup" : "drop"}`}
            </Button>
          </footer>
        </div>
      </SheetContent>
    </Sheet>
  );
}
