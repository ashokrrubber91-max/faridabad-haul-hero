import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "customer" | "driver" | "admin";
export type ActiveMode = "customer" | "driver";
export type KycStatus = "not_submitted" | "pending" | "approved" | "rejected";

export type LocationShareState = "idle" | "starting" | "live" | "error";

export interface DriverLocationShare {
  state: LocationShareState;
  message: string | null;
  /** Time of the last real device fix that was saved, or null if none yet. */
  lastFixAt: number | null;
  stale: boolean;
  retry: () => void;
}

export interface AuthState {
  loading: boolean;
  user: User | null;
  role: AppRole | null;
  roles: AppRole[];
  profile: {
    name: string;
    phone: string;
    active_mode: ActiveMode;
    is_online: boolean;
    kyc_status: KycStatus;
    service_zone: string;
  } | null;
  activeMode: ActiveMode;
  setActiveMode: (m: ActiveMode) => Promise<void>;
  locationShare: DriverLocationShare;
}


export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<AuthState["profile"]>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadFor = async (u: User | null) => {
      if (!u) {
        if (!active) return;
        setRoles([]);
        setProfile(null);
        setLoading(false);
        return;
      }
      const [{ data: roleRows }, { data: profileRow }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", u.id),
        supabase
          .from("profiles")
          .select("name, phone, active_mode, is_online, kyc_status, service_zone")
          .eq("id", u.id)
          .maybeSingle(),
      ]);
      if (!active) return;
      setRoles((roleRows ?? []).map((r) => r.role as AppRole));
      setProfile(
        profileRow
          ? {
              name: profileRow.name ?? "",
              phone: profileRow.phone ?? "",
              active_mode: (profileRow.active_mode as ActiveMode) ?? "customer",
              is_online: profileRow.is_online ?? false,
              kyc_status: ((profileRow as { kyc_status?: KycStatus }).kyc_status ??
                "not_submitted") as KycStatus,
              service_zone: profileRow.service_zone ?? "Faridabad",
            }
          : null,
      );
      setLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      loadFor(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(true);
      loadFor(session?.user ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /**
   * Real driver GPS, shared from one watcher only. A blocked or failing device
   * is reported honestly (MiniPort cannot override an Android/browser block),
   * saving is throttled so a moving vehicle does not flood the database, and a
   * failed watcher is retried with a growing delay until it works.
   */
  const [share, setShare] = useState<{
    state: LocationShareState;
    message: string | null;
    lastFixAt: number | null;
  }>({ state: "idle", message: null, lastFixAt: null });
  const [geoAttempt, setGeoAttempt] = useState(0);
  const retryLocation = useCallback(() => setGeoAttempt((n) => n + 1), []);

  const sharingEnabled =
    !!user && roles.includes("driver") && profile?.kyc_status === "approved";

  useEffect(() => {
    if (!sharingEnabled || !user) {
      setShare({ state: "idle", message: null, lastFixAt: null });
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setShare({
        state: "error",
        message: GEO_MESSAGES.unsupported,
        lastFixAt: null,
      });
      return;
    }

    let cancelled = false;
    let watchId: number | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let lastSentAt = 0;
    let notifiedCode: number | null = null;

    setShare((s) => ({ ...s, state: "starting", message: null }));

    const start = () => {
      if (cancelled) return;
      watchId = navigator.geolocation.watchPosition(
        async (position) => {
          if (cancelled) return;
          failures = 0;
          notifiedCode = null;
          const now = Date.now();
          setShare({ state: "live", message: null, lastFixAt: position.timestamp || now });
          // At most one write every 10 seconds; the watcher can fire far more often.
          if (now - lastSentAt < 10_000) return;
          lastSentAt = now;
          const { latitude, longitude, accuracy, heading, speed } = position.coords;
          const { error } = await supabase.from("driver_locations").upsert(
            {
              driver_id: user.id,
              latitude,
              longitude,
              accuracy_m: accuracy ?? null,
              heading_deg: heading ?? null,
              speed_mps: speed ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "driver_id" },
          );
          if (error && !cancelled) {
            lastSentAt = 0;
            setShare((s) => ({
              ...s,
              message: "Your live location could not be saved. Check your internet connection.",
            }));
          }
        },
        (error) => {
          if (cancelled) return;
          const message =
            error.code === error.PERMISSION_DENIED
              ? GEO_MESSAGES.denied
              : error.code === error.TIMEOUT
                ? GEO_MESSAGES.timeout
                : GEO_MESSAGES.unavailable;
          setShare((s) => ({ ...s, state: "error", message }));
          if (notifiedCode !== error.code) {
            notifiedCode = error.code;
            toast.error(message);
          }
          if (error.code === error.PERMISSION_DENIED) return; // retrying cannot help
          failures += 1;
          if (watchId !== null) navigator.geolocation.clearWatch(watchId);
          watchId = null;
          const delay = Math.min(60_000, 5_000 * 2 ** (failures - 1));
          retryTimer = setTimeout(start, delay);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
    };

    start();
    return () => {
      cancelled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [sharingEnabled, user, geoAttempt]);

  const locationShare: DriverLocationShare = {
    state: share.state,
    message: share.message,
    lastFixAt: share.lastFixAt,
    stale: share.state === "live" ? isStaleFix(share.lastFixAt) : false,
    retry: retryLocation,
  };


  const role: AppRole | null = roles.includes("admin")
    ? "admin"
    : roles.includes("driver")
      ? "driver"
      : roles.includes("customer")
        ? "customer"
        : null;
  const activeMode: ActiveMode = profile?.active_mode ?? "customer";
  const setActiveMode = useCallback(
    async (m: ActiveMode) => {
      if (!user) return;
      setProfile((p) => (p ? { ...p, active_mode: m } : p));
      const { error } = await supabase
        .from("profiles")
        .update({ active_mode: m })
        .eq("id", user.id);
      if (error) {
        setProfile((p) =>
          p ? { ...p, active_mode: m === "customer" ? "driver" : "customer" } : p,
        );
        throw error;
      }
    },
    [user],
  );

  return { user, role, roles, profile, activeMode, setActiveMode, loading };
}

/**
 * Indian mobile numbers are exactly 10 digits starting 6-9. Anything shorter,
 * longer or starting 0-5 is rejected — never silently trimmed to 10 digits.
 */
export const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export function normalisePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export function isValidIndianMobile(raw: string): boolean {
  return INDIAN_MOBILE.test(normalisePhone(raw));
}

export const PHONE_ERROR =
  "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.";

export function phoneToEmail(phone: string): string {
  return `${normalisePhone(phone)}@miniport.app`;
}
