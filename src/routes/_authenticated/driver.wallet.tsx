import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Wallet, ArrowUpRight, ArrowDownLeft, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/driver/wallet")({
  head: () => ({ meta: [{ title: "Wallet — MiniPort Driver" }] }),
  component: WalletPage,
});

function WalletPage() {
  const { user } = useAuth();

  const wallet = useQuery({
    queryKey: ["driver-wallet", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("wallet_accounts")
        .select("cash_balance,coins_balance")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data ?? { cash_balance: 0, coins_balance: 0 };
    },
  });

  const txns = useQuery({
    queryKey: ["driver-txns", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const cash = Number(wallet.data?.cash_balance ?? 0);
  const low = cash < 100;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/driver"><ArrowLeft className="h-4 w-4" /> Back</Link>
        </Button>
      </div>

      <section className="surface-card p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Available Balance for Withdrawal</p>
        <div className="mt-1 flex items-baseline gap-2">
          <Wallet className="h-6 w-6 text-primary" />
          <p className="font-display text-4xl text-secondary">₹{cash.toFixed(2)}</p>
        </div>
        {low && (
          <p className="mt-2 rounded-md bg-warning/15 px-3 py-2 text-xs text-warning-foreground">
            Minimum wallet balance of ₹100 is required to receive new jobs. Please top-up your wallet to avoid getting offline.
          </p>
        )}
        <Button
          className="mt-4 w-full sm:w-auto"
          onClick={() => toast.info("Bank/UPI payouts coming soon")}
        >
          <Building2 className="h-4 w-4" /> Transfer to Bank / UPI
        </Button>
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl tracking-wide text-secondary">Transaction history</h2>
        {txns.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : (txns.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet. Complete a trip to start earning.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
            {(txns.data ?? []).map((t) => {
              const positive = Number(t.delta) >= 0;
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full ${positive ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                      {positive ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-secondary">{t.reason}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(t.created_at).toLocaleString()}
                        {t.booking_id ? ` · Trip #${t.booking_id.slice(0, 8)}` : ""}
                      </p>
                    </div>
                  </div>
                  <p className={`font-display text-lg ${positive ? "text-success" : "text-destructive"}`}>
                    {positive ? "+" : ""}₹{Number(t.delta).toFixed(0)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
