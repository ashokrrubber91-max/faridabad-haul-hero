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
  syncError: string | null;
  retryAccountSync: () => void;
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
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const retryAccountSync = useCallback(() => {
    setSyncError(null);
    setLoading(true);
    setSyncAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const markSyncError = () => {
      if (!active) return;
      // Preserve any recovered session and show a retry action instead of
      // falsely signing the user out when the network is temporarily down.
      setSyncError("Account sync failed. Check your internet connection and retry.");
      setLoading(false);
    };

    const loadFor = async (u: User | null) => {
      if (!u) {
        if (!active) return;
        setRoles([]);
        setProfile(null);
        setSyncError(null);
        setLoading(false);
        return;
      }

      try {
        // Retry transient auth refresh/network delays before marking account sync as failed.
        let roleRows: { role: string }[] | null = null;
        let profileRow: {
          name: string | null;
          phone: string;
          active_mode: string;
          is_online: boolean;
          kyc_status: KycStatus;
          service_zone: string;
        } | null = null;
        let lastError: unknown = null;
        // Profile mirror failures (for example a permission error) must not
        // block role-gated screens such as the driver feed.
        let profileError: { message?: string } | null = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const query = Promise.all([
              supabase.from("user_roles").select("role").eq("user_id", u.id),
              supabase
                .from("profiles")
                .select("name, phone, active_mode, is_online, kyc_status, service_zone")
                .eq("id", u.id)
                .maybeSingle(),
            ]);
            const result = await Promise.race([
              query,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("AUTH_PROFILE_TIMEOUT")), 12000),
              ),
            ]);
            const [roleResult, profileResult] = result;
            if (roleResult.error) throw roleResult.error;
            roleRows = roleResult.data;
            if (profileResult.error) {
              profileError = profileResult.error;
              // Retry transient failures; on the last attempt fall through with roles only.
              if (attempt < 2) throw profileResult.error;
            } else {
              profileError = null;
              profileRow = profileResult.data;
            }
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt < 2) {
              // Refresh an expiring session once, then retry with backoff.
              if (attempt === 0) {
                try {
                  await supabase.auth.refreshSession();
                } catch {
                  // A normal retry below is still useful if refresh is unavailable.
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
            }
          }
        }

        // Roles are required for route gating; a profile-only failure is degraded, not fatal.
        if (lastError && !(roleRows && profileError)) throw lastError;
        if (!active) return;
        setSyncError(null);
        if (profileError) {
          console.warn("[MiniPort] Profile sync failed; continuing without profile", {
            message: profileError.message,
          });
          setProfileSyncError("Some account details could not be loaded.");
        } else {
          setProfileSyncError(null);
        }
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
        markSyncError();
      }
    };

    let currentUserId: string | null = null;

    try {
      // Resolve persisted session before protected routes and booking screens
      // are considered ready. A failed refresh remains retryable.
      void supabase.auth
        .getSession()
        .then(({ data, error }) => {
          if (!active) return;
          if (error) {
            markSyncError();
            return;
          }
          const u = data.session?.user ?? null;
          currentUserId = u?.id ?? null;
          setUser(u);
          setSyncError(null);
          void loadFor(u);
        })
        .catch(() => markSyncError());

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
        const u = session?.user ?? null;
        if (u?.id === currentUserId && event !== "USER_UPDATED") return;
        currentUserId = u?.id ?? null;
        setUser(u);
        setLoading(true);
        setSyncError(null);
        void loadFor(u);
      });
      subscription = sub.subscription;
    } catch {
      markSyncError();
    }

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [syncAttempt]);

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
          try {
            window.localStorage.setItem(
              `miniport-last-driver-fix:${user.id}`,
              JSON.stringify({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                at: position.timestamp || now,
              }),
            );
          } catch {
            // GPS still works if browser storage is unavailable.
          }
          setShare((previous) => {
            const lastFixAt = position.timestamp || now;
            if (
              previous.state === "live" &&
              !previous.message &&
              lastFixAt - (previous.lastFixAt ?? 0) < 10_000
            )
              return previous;
            return { state: "live", message: null, lastFixAt };
          });
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
          let lastKnownAt: number | null = null;
          try {
            const raw = window.localStorage.getItem(`miniport-last-driver-fix:${user.id}`);
            if (raw) {
              const cached = JSON.parse(raw) as { lat?: number; lng?: number; at?: number };
              if (
                Number.isFinite(cached.lat) &&
                Number.isFinite(cached.lng) &&
                Number.isFinite(cached.at)
              ) {
                lastKnownAt = cached.at!;
              }
            }
          } catch {
            // A missing cache must not prevent GPS retry.
          }
          const displayMessage =
            error.code === error.TIMEOUT && lastKnownAt !== null
              ? "GPS is taking longer than usual. Last saved location is available while we retry; keep GPS on for live dispatch."
              : message;
          setShare((s) => ({
            ...s,
            state: "error",
            message: displayMessage,
            lastFixAt: lastKnownAt ?? s.lastFixAt,
          }));
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
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 60000 },
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

  return {
    user,
    role,
    roles,
    profile,
    activeMode,
    setActiveMode,
    loading,
    syncError,
    retryAccountSync,
    locationShare,
  };
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
