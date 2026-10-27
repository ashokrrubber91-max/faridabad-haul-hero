import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useWalletBalances() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["wallet", user?.id, "balances"],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      if (!user) throw new Error("Sign in to view your balance.");
      const { data, error } = await supabase
        .from("wallet_accounts")
        .select("coins_balance,cash_balance")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return {
        coins: Math.max(0, Number(data?.coins_balance ?? 0)),
        cash: Math.max(0, Number(data?.cash_balance ?? 0)),
      };
    },
  });
}
