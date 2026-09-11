import { useCallback, useEffect, useState } from "react";
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
  profile: { name: string; phone: string; active_mode: ActiveMode; is_online: boolean; kyc_status: KycStatus; service_zone: string } | null;
  activeMode: ActiveMode;
  setActiveMode: (m: ActiveMode) => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<{ name: string; phone: string; active_mode: ActiveMode; is_online: boolean; kyc_status: KycStatus; service_zone: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const metadataRole = (u: User): AppRole | null => {
      const role = u.user_metadata?.role;
      return role === "customer" || role === "driver" || role === "admin" ? role : null;
    };
    const loadFor = async (u: User | null) => {
      if (!u) {
        if (!active) return;
        setRoles([]); setProfile(null); setLoading(false); return;
      }
      const [{ data: roleRows }, { data: profileRow }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", u.id),
        supabase.from("profiles").select("name, phone, active_mode, is_online, kyc_status, service_zone").eq("id", u.id).maybeSingle(),
      ]);
      if (!active) return;
      const dbRoles = (roleRows ?? []).map((r) => r.role as AppRole);
      const fallbackRole = metadataRole(u);
      setRoles(dbRoles.length > 0 ? dbRoles : fallbackRole ? [fallbackRole] : []);
      setProfile(profileRow ? {
        ...profileRow,
        active_mode: (profileRow.active_mode as ActiveMode) ?? "customer",
        is_online: profileRow.is_online ?? false,
               kyc_status: ((profileRow as { kyc_status?: KycStatus }).kyc_status ?? "not_submitted") as KycStatus,
               service_zone: profileRow.service_zone ?? "Faridabad",
      } : null);
      setLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); loadFor(data.session?.user ?? null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null); setLoading(true); loadFor(session?.user ?? null);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // Real driver GPS. Location is stored privately and is only readable by the
  // driver, admins, or a customer with an active booking assigned to that driver.
  useEffect(() => {
    if (!user || !roles.includes("driver") || profile?.kyc_status !== "approved") return;
    if (!navigator.geolocation) return;
    const db = supabase as any;
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        await db.from("driver_locations").upsert({
          driver_id: user.id,
          latitude,
          longitude,
          accuracy_m: accuracy ?? null,
          heading_deg: heading ?? null,
          speed_mps: speed ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "driver_id" });
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [user, roles, profile?.kyc_status]);

  const role: AppRole | null = roles.includes("admin") ? "admin" : roles.includes("driver") ? "driver" : roles.includes("customer") ? "customer" : null;
  const activeMode: ActiveMode = profile?.active_mode ?? "customer";
  const setActiveMode = useCallback(async (m: ActiveMode) => {
    if (!user) return;
    setProfile((p) => (p ? { ...p, active_mode: m } : p));
    const { error } = await supabase.from("profiles").update({ active_mode: m }).eq("id", user.id);
    if (error) {
      setProfile((p) => (p ? { ...p, active_mode: m === "customer" ? "driver" : "customer" } : p));
      throw error;
    }
  }, [user]);

  return { user, role, roles, profile, activeMode, setActiveMode, loading };
}

export function phoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@miniport.app`;
}
