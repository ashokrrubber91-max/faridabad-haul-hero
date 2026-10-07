import type { SupabaseClient as UntypedClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { Clock3, IndianRupee, ShieldCheck, Zap, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { MINIPORT_TEST_MODE } from "@/lib/testing";

type PassRow = {
  id: string;
  driver_id: string;
  starts_at: string;
  ends_at: string;
  amount: number;
  status: string;
};

function formatRemaining(ms: number) {
  const remainingMs = Math.max(0, ms);
  const hours = Math.floor(remainingMs / (1000 * 60 * 60));
  const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours + "h " + minutes.toString().padStart(2, "0") + "m";
}

export function DailyPassCard() {
  const { user } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [rechargeBusy, setRechargeBusy] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const pass = useQuery({
    queryKey: ["driver-daily-pass", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as UntypedClient)
        .from("driver_daily_passes")
        .select("id,driver_id,starts_at,ends_at,amount,status")
        .eq("driver_id", user!.id)
        .eq("status", "active")
        .lte("starts_at", new Date().toISOString())
        .gt("ends_at", new Date().toISOString())
        .order("ends_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as PassRow | null;
    },
    refetchInterval: 30_000,
  });

  const wallet = useQuery({
    queryKey: ["driver-daily-pass-wallet", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_accounts")
        .select("cash_balance")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.cash_balance ?? 0);
    },
    refetchInterval: 30_000,
  });

  const activate = async () => {
    setBusy(true);
    try {
      const { data, error } = await (supabase as unknown as UntypedClient).rpc(
        "purchase_daily_pass",
        { p_driver_id: user!.id, p_pass_price: 99 },
      );
      if (error) throw error;
      const result = data as { success?: boolean; message?: string };
      if (!result?.success) throw new Error(result?.message || "Could not activate Daily Pass");
      toast.success("₹99 Daily Pass activated for 24 hours");
      await Promise.all([
        pass.refetch(),
        wallet.refetch(),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not activate Daily Pass");
    } finally {
      setBusy(false);
    }
  };

  const testRecharge = async () => {
    setRechargeBusy(true);
    try {
      const { data, error } = await (supabase as unknown as UntypedClient).rpc(
        "test_recharge_driver_wallet",
        { p_amount: 500 },
      );
      if (error) throw error;
      toast.success("Test recharge +₹500 added");
      await wallet.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test recharge failed");
    } finally {
      setRechargeBusy(false);
    }
  };

  const active = pass.data;
  const balance = wallet.data ?? 0;
  const remaining = useMemo(
    () => (active ? new Date(active.ends_at).getTime() - now : 0),
    [active, now],
  );

  return (
    <section className="surface-card border-primary/30 bg-primary/5 p-5">
      <div className="flex items-start gap-3">
        <div className="brand-gradient grid h-11 w-11 shrink-0 place-items-center rounded-full">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl tracking-wide text-secondary">
            ₹99 Daily Unlimited Pass
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            24 hours • 0% MiniPort commission on completed rides while active.
          </p>
        </div>
      </div>

      {active && remaining > 0 ? (
        <div className="mt-4 rounded-md border border-success/30 bg-success/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-success">
              <ShieldCheck className="h-4 w-4" />
              Active Pass (0% Commission)
            </div>
            <span className="rounded-full bg-success/10 px-2 py-1 text-xs font-semibold text-success">
              Expires in: {formatRemaining(remaining)}
            </span>
          </div>
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Expires {new Date(active.ends_at).toLocaleString("en-IN")}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-1 text-sm font-semibold text-secondary">
                <IndianRupee className="h-4 w-4 text-primary" /> ₹99 from wallet
              </p>
              <p className="text-xs text-muted-foreground">Wallet balance: ₹{balance.toFixed(0)}</p>
            </div>
            {balance >= 99 ? (
              <Button onClick={() => void activate()} disabled={busy}>
                {busy ? "Activating…" : "Activate for ₹99"}
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link to="/wallet">Add money to wallet</Link>
              </Button>
            )}
          </div>

          {MINIPORT_TEST_MODE && (
            <Button
              size="sm"
              variant="outline"
              className="w-full sm:w-fit"
              onClick={() => void testRecharge()}
              disabled={rechargeBusy}
            >
              <FlaskConical className="h-4 w-4" />
              {rechargeBusy ? "Adding…" : "Test Recharge (+₹500)"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
