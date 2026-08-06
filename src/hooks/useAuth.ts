import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "customer" | "driver" | "admin";
export type ActiveMode = "customer" | "driver";

export type KycStatus = "not_submitted" | "pending" | "approved" | "rejected";

export interface AuthState {
  loading: boolean;
  user: User | null;
  role: AppRole | null;
  roles: AppRole[];
  profile: { name: string; phone: string; active_mode: ActiveMode; is_online: boolean; kyc_status: KycStatus } | null;
  activeMode: ActiveMode;
  setActiveMode: (m: ActiveMode) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<{ name: string; phone: string; active_mode: ActiveMode; is_online: boolean; kyc_status: KycStatus } | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<User | null>(null);
  const activeRef = useRef(true);

  const loadFor = useCallback(async (u: User | null) => {
    if (!u) {
      if (!activeRef.current) return;
      setRoles([]);
      setProfile(null);
      setLoading(false);
      return;
    }
    const [{ data: roleRows }, { data: profileRow }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", u.id),
      supabase.from("profiles").select("name, phone, active_mode, is_online, kyc_status").eq("id", u.id).maybeSingle(),
    ]);
    if (!activeRef.current) return;
    const metadataRole = (() => {
      const role = u.user_metadata?.role;
      return role === "customer" || role === "driver" || role === "admin" ? (role as AppRole) : null;
    })();
    const dbRoles = (roleRows ?? []).map((r) => r.role as AppRole);
    setRoles(dbRoles.length > 0 ? dbRoles : metadataRole ? [metadataRole] : []);
    setProfile(
      profileRow
        ? {
            ...profileRow,
            active_mode: (profileRow.active_mode as ActiveMode) ?? "customer",
            is_online: profileRow.is_online ?? false,
            kyc_status: ((profileRow as { kyc_status?: KycStatus }).kyc_status ?? "not_submitted") as KycStatus,
          }
        : null,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    activeRef.current = true;

    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      userRef.current = u;
      setUser(u);
      loadFor(u);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      userRef.current = u;
      setUser(u);
      setLoading(true);
      loadFor(u);
    });

    return () => {
      activeRef.current = false;
      sub.subscription.unsubscribe();
    };
  }, [loadFor]);

  // Keep role / KYC status fresh: admin approvals happen outside this session, so
  // the driver's own view must pick them up without a manual sign-out.
  useEffect(() => {
    if (!user) return;
    const reload = () => loadFor(userRef.current);

    const channel = supabase
      .channel(`self-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `id=eq.${user.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_kyc", filter: `driver_id=eq.${user.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${user.id}` }, reload)
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const poll = window.setInterval(reload, 30000);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(poll);
    };
  }, [user, loadFor]);

  const role: AppRole | null =
    roles.includes("admin") ? "admin" : roles.includes("driver") ? "driver" : roles.includes("customer") ? "customer" : null;

  const activeMode: ActiveMode = profile?.active_mode ?? "customer";

  const setActiveMode = useCallback(
    async (m: ActiveMode) => {
      if (!user) return;
      setProfile((p) => (p ? { ...p, active_mode: m } : p));
      const { error } = await supabase.from("profiles").update({ active_mode: m }).eq("id", user.id);
      if (error) {
        // revert on failure
        setProfile((p) => (p ? { ...p, active_mode: m === "customer" ? "driver" : "customer" } : p));
        throw error;
      }
    },
    [user],
  );

  const refresh = useCallback(async () => {
    await loadFor(userRef.current);
  }, [loadFor]);

  return { user, role, roles, profile, activeMode, setActiveMode, loading, refresh };
}

/** Turn a phone number into the synthetic email we use for Supabase email/password auth. */
export function phoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@miniport.app`;
}
