import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useAdminWallets() {
  return useQuery({
    queryKey: ["admin-wallets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wallet_accounts").select("user_id, cash_balance, coins_balance");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10_000,
  });
}
