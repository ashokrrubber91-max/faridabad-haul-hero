import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { GEO_MESSAGES, isStaleFix } from "@/lib/geolocation";

export type AppRole = "customer" | "driver" | "admin";
export type ActiveMode = "customer" | "driver";
export type KycStatus = "not_submitted" | "pending" | "approved" | "rejected";

export type LocationShareState = "idle" | "starting" | "live" | "error";

export interface DriverLocationShare {
  state: LocationShareState;
  message: string | null;
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
    let subscription: { unsubscribe: () => void } | null = null;

    const failClosed = () => {
      if (!active) return;
      // A preview/configuration failure must not blank the public app.
      // Keep the user signed out until Supabase becomes available.
      setUser(null);
      setRoles([]);
      setProfile(null);
      setLoading(false);
    };

    const loadFor = async (u: User | null) => {
      if (!u) {
        if (!active) return;
        setRoles([]);
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        const query = Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", u.id),
          supabase
            .from("profiles")
            .select("name, phone, active_mode, is_online, kyc_status, service_zone")
            .eq("id", u.id)
            .maybeSingle(),
        ]);
        const [{ data: roleRows }, { data: profileRow }] = await Promise.race([
          query,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("AUTH_PROFILE_TIMEOUT")), 12000),
          ),
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
      } catch {
        failClosed();
      }
    };

    let currentUserId: string | null = null;

    try {
      supabase.auth
        .getSession()
        .then(({ data }) => {
          const u = data.session?.user ?? null;
          currentUserId = u?.id ?? null;
          setUser(u);
          void loadFor(u);
        })
        .catch(() => failClosed());

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
        const u = session?.user ?? null;
        if (u?.id === currentUserId && event !== "USER_UPDATED") return;
        currentUserId = u?.id ?? null;
        setUser(u);
        setLoading(true);
        void loadFor(u);
      });
      subscription = sub.subscription;
    } catch {
      failClosed();
    }

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const [share, setShare] = useState<{
    state: LocationShareState;
    message: string | null;
    lastFixAt: number | null;
  }>({ state: "idle", message: null, lastFixAt: null });
  const [geoAttempt, setGeoAttempt] = useState(0);
  const retryLocation = useCallback(() => setGeoAttempt((n) => n + 1), []);

  const sharingEnabled = !!user && roles.includes("driver") && profile?.kyc_status === "approved";

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
          if (now - lastSentAt < 10_000) return;
          lastSentAt = now;
          const { latitude, longitude, accuracy, heading, speed } = position.coords;
          try {
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
          } catch {
            if (!cancelled) {
              lastSentAt = 0;
              setShare((s) => ({
                ...s,
                message: "Your live location could not be saved. Check your internet connection.",
              }));
            }
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
          if (error.code === error.PERMISSION_DENIED) return;
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
      try {
        const { error } = await supabase
          .from("profiles")
          .update({ active_mode: m })
          .eq("id", user.id);
        if (error) throw error;
      } catch (error) {
        setProfile((p) =>
          p ? { ...p, active_mode: m === "customer" ? "driver" : "customer" } : p,
        );
        throw error;
      }
    },
    [user],
  );

  return { user, role, roles, profile, activeMode, setActiveMode, loading, locationShare };
}

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
