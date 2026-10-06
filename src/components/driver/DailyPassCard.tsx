import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Clock3, IndianRupee, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";

type PassRow = {
  id: string;
  driver_id: string;
  starts_at: string;
  ends_at: string;
  amount: number;
  status: string;
};

function formatRemaining(ms: number) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function DailyPassCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const pass = useQuery({
    queryKey: ["driver-daily-pass", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
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
        .maybeSingle();
      if (error) throw error;
      return Number(data?.cash_balance ?? 0);
    },
    refetchInterval: 30_000,
  });

  const activate = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("activate_driver_daily_pass");
      if (error) throw error;
      return data as PassRow;
    },
    onSuccess: () => {
      toast.success("₹99 Daily Pass activated for 24 hours");
      void qc.invalidateQueries({ queryKey: ["driver-daily-pass"] });
      void qc.invalidateQueries({ queryKey: ["driver-daily-pass-wallet"] });
      void qc.invalidateQueries({ queryKey: ["driver-wallet"] });
      void qc.invalidateQueries({ queryKey: ["driver-feed"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not activate Daily Pass"),
  });

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
              {formatRemaining(remaining)} left
            </span>
          </div>
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Expires {new Date(active.ends_at).toLocaleString("en-IN")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Completed rides during the active pass receive 100% of the fare with no MiniPort commission.
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-1 text-sm font-semibold text-secondary">
              <IndianRupee className="h-4 w-4 text-primary" /> ₹99 from wallet
            </p>
            <p className="text-xs text-muted-foreground">
              Wallet balance: ₹{balance.toFixed(0)}
            </p>
          </div>
          {balance >= 99 ? (
            <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
              {activate.isPending ? "Activating…" : "Activate for ₹99"}
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link to="/wallet">Add money to wallet</Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
