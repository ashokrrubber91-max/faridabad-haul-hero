import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "customer" | "driver" | "admin";
export type ActiveMode = "customer" | "driver";

export interface AuthState {
  loading: boolean;
  user: User | null;
  role: AppRole | null;
  roles: AppRole[];
  profile: { name: string; phone: string; active_mode: ActiveMode; is_online: boolean } | null;
  activeMode: ActiveMode;
  setActiveMode: (m: ActiveMode) => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<{ name: string; phone: string; active_mode: ActiveMode; is_online: boolean } | null>(null);
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
        supabase.from("profiles").select("name, phone, active_mode, is_online").eq("id", u.id).maybeSingle(),
      ]);
      if (!active) return;
      setRoles((roleRows ?? []).map((r) => r.role as AppRole));
      setProfile(
        profileRow
          ? {
              ...profileRow,
              active_mode: (profileRow.active_mode as ActiveMode) ?? "customer",
              is_online: profileRow.is_online ?? false,
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

  return { user, role, roles, profile, activeMode, setActiveMode, loading };
}

/** Turn a phone number into the synthetic email we use for Supabase email/password auth. */
export function phoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@miniport.app`;
}
