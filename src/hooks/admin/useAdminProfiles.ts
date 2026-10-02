import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type AdminProfile = Pick<Tables<"profiles">, "id" | "name" | "phone" | "active_mode" | "is_online" | "kyc_status">;

export function useAdminProfiles() {
  return useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, name, phone, active_mode, is_online, kyc_status");
      if (error) throw error;
      return (data ?? []) as AdminProfile[];
    },
    staleTime: 10_000,
  });
}
