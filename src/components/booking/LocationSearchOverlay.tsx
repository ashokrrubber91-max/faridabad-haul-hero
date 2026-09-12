import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Search, Home, Store, Bookmark, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { loadGoogleMaps, FARIDABAD_CENTER } from "@/lib/google-maps";
import { useQuery } from "@tanstack/react-query";

export type PlacePick = {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
  alias?: string;
  contactName?: string;
  contactPhone?: string;
  kind?: "home" | "shop" | "other";
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "pickup" | "drop";
  onPick: (p: PlacePick) => void;
}

export function LocationSearchOverlay({ open, onOpenChange, mode, onPick }: Props) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const placesLibRef = useRef<google.maps.PlacesLibrary | null>(null);

  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);


  const saved = useQuery({
    queryKey: ["saved-addresses", user?.id],
    enabled: !!user && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_addresses")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  /**
   * Recent locations come from the customer's own past bookings (own rows only,
   * so RLS already scopes this). Only entries that stored an exact pin are
   * offered, because a booking needs real coordinates.
   */
  const recent = useQuery({
    queryKey: ["recent-locations", user?.id, mode],
    enabled: !!user && open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("pickup_address, pickup_lat, pickup_lng, drop_address, drop_lat, drop_lng")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      const out: PlacePick[] = [];
      const seen = new Set<string>();
      for (const b of data ?? []) {
        const candidates =
          mode === "pickup"
            ? [
                { address: b.pickup_address, lat: b.pickup_lat, lng: b.pickup_lng },
                { address: b.drop_address, lat: b.drop_lat, lng: b.drop_lng },
              ]
            : [
                { address: b.drop_address, lat: b.drop_lat, lng: b.drop_lng },
                { address: b.pickup_address, lat: b.pickup_lat, lng: b.pickup_lng },
              ];
        for (const c of candidates) {
          if (typeof c.lat !== "number" || typeof c.lng !== "number") continue;
          const key = c.address.trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({ address: c.address, lat: c.lat, lng: c.lng });
        }
      }
      return out.slice(0, 6);
    },
  });

  /** Real device GPS + Google reverse geocoding. Never a guessed address. */
  const useCurrentLocation = async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("This device cannot share its location.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const g = await loadGoogleMaps();
          const geocoder = new g.maps.Geocoder();
          const res = await geocoder.geocode({
            location: { lat: latitude, lng: longitude },
          });
          const address = res.results[0]?.formatted_address;
          onPick({
            address: address ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            lat: latitude,
            lng: longitude,
          });
        } catch {
          // Coordinates are real even when the address lookup fails; the pin
          // confirm step lets the customer adjust and label it.
          onPick({
            address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            lat: latitude,
            lng: longitude,
          });
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is off. Allow location or search the address instead."
            : "Could not get your location. Please search the address instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadGoogleMaps()
      .then(async (g) => {
        const lib = (await g.maps.importLibrary("places")) as google.maps.PlacesLibrary;
        if (cancelled) return;
        placesLibRef.current = lib;
        tokenRef.current = new lib.AutocompleteSessionToken();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim() || !placesLibRef.current) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        setLoading(true);
        const { suggestions } =
          await placesLibRef.current!.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            sessionToken: tokenRef.current ?? undefined,
            locationBias: {
              center: FARIDABAD_CENTER,
              radius: 25000,
            } as google.maps.CircleLiteral,
            includedRegionCodes: ["in"],
          });
        setSuggestions(suggestions);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [query, open]);

  const handlePickSuggestion = async (s: google.maps.places.AutocompleteSuggestion) => {
    const pp = s.placePrediction;
    if (!pp) return;
    try {
      const place = pp.toPlace();
      await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] });
      const loc = place.location;
      if (!loc) return;
      onPick({
        address: place.formattedAddress ?? pp.text.text,
        lat: loc.lat(),
        lng: loc.lng(),
        placeId: pp.placeId ?? undefined,
      });
      setQuery("");
      setSuggestions([]);
      tokenRef.current = placesLibRef.current
        ? new placesLibRef.current.AutocompleteSessionToken()
        : null;
    } catch {
      /* ignore */
    }
  };

  const title = mode === "pickup" ? "Pickup location" : "Drop location";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[100dvh] w-full max-w-full p-0 sm:max-w-full">
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-2 border-b bg-background px-4 py-3">
            <button onClick={() => onOpenChange(false)} aria-label="Close" className="p-1">
              <X className="h-5 w-5" />
            </button>
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
              <div className="mt-1 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search building, area, landmark"
                  className="h-7 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                />
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            {query.trim().length === 0 ? (
              <SavedList
                addresses={saved.data ?? []}
                loading={saved.isLoading}
                onPick={(a) =>
                  onPick({
                    address: a.address,
                    lat: a.latitude ?? FARIDABAD_CENTER.lat,
                    lng: a.longitude ?? FARIDABAD_CENTER.lng,
                    placeId: a.place_id ?? undefined,
                    alias: a.alias ?? undefined,
                    contactName: a.contact_name ?? undefined,
                    contactPhone: a.contact_phone ?? undefined,
                    kind: a.kind,
                  })
                }
              />
            ) : (
              <ul className="divide-y">
                {suggestions.map((s, i) => {
                  const pp = s.placePrediction;
                  if (!pp) return null;
                  return (
                    <li key={i}>
                      <button
                        onClick={() => handlePickSuggestion(s)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-secondary">
                            {pp.mainText?.text ?? pp.text.text}
                          </p>
                          {pp.secondaryText?.text && (
                            <p className="truncate text-xs text-muted-foreground">
                              {pp.secondaryText.text}
                            </p>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
                {!loading && suggestions.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No matches yet
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SavedList({
  addresses,
  loading,
  onPick,
}: {
  addresses: Array<{
    id: string;
    kind: "home" | "shop" | "other";
    alias: string | null;
    address: string;
    latitude: number | null;
    longitude: number | null;
    place_id: string | null;
    contact_name: string | null;
    contact_phone: string | null;
  }>;
  loading: boolean;
  onPick: (a: (typeof addresses)[number]) => void;
}) {
  const grouped = useMemo(() => {
    const home = addresses.filter((a) => a.kind === "home").slice(0, 1);
    const shops = addresses.filter((a) => a.kind === "shop");
    const others = addresses.filter((a) => a.kind === "other");
    return { home, shops, others };
  }, [addresses]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (addresses.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-muted-foreground">
        <Bookmark className="mx-auto mb-2 h-5 w-5" />
        Saved addresses appear here. Start typing to search.
      </div>
    );
  }

  return (
    <div className="p-3">
      <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Saved addresses
      </p>
      <ul className="space-y-1">
        {grouped.home.map((a) => (
          <SavedRow
            key={a.id}
            a={a}
            icon={<Home className="h-4 w-4" />}
            title="Home"
            onPick={onPick}
          />
        ))}
        {grouped.shops.map((a) => (
          <SavedRow
            key={a.id}
            a={a}
            icon={<Store className="h-4 w-4" />}
            title={a.alias || "Shop"}
            onPick={onPick}
          />
        ))}
        {grouped.others.map((a) => (
          <SavedRow
            key={a.id}
            a={a}
            icon={<Bookmark className="h-4 w-4" />}
            title={a.alias || "Saved"}
            onPick={onPick}
          />
        ))}
      </ul>
    </div>
  );
}

function SavedRow({
  a,
  icon,
  title,
  onPick,
}: {
  a: { address: string };
  icon: React.ReactNode;
  title: string;
  onPick: (a: never) => void;
}) {
  return (
    <li>
      <button
        onClick={() => onPick(a as never)}
        className="flex w-full items-start gap-3 rounded-md px-3 py-3 text-left hover:bg-muted"
      >
        <span className="mt-0.5 text-primary">{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-secondary">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{a.address}</p>
        </div>
      </button>
    </li>
  );
}
