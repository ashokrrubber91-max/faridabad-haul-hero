import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "customer" | "driver" | "admin";

export interface AuthState {
  loading: boolean;
  user: User | null;
  role: AppRole | null;
  roles: AppRole[];
  profile: { name: string; phone: string } | null;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<{ name: string; phone: string } | null>(null);
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
        supabase.from("profiles").select("name, phone").eq("id", u.id).maybeSingle(),
      ]);
      if (!active) return;
      setRoles((roleRows ?? []).map((r) => r.role as AppRole));
      setProfile(profileRow ?? null);
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

  return { user, role, roles, profile, loading };
}

/** Turn a phone number into the synthetic email we use for Supabase email/password auth. */
export function phoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@miniport.app`;
}
