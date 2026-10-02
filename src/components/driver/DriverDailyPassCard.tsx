import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function DriverDailyPassCard() {
  const qc = useQueryClient();
  const active = useQuery({
    queryKey: ["driver-daily-pass"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_daily_passes")
        .select("id,starts_at,ends_at,status,amount")
        .eq("status","active")
        .gt("ends_at", new Date().toISOString())
        .order("ends_at",{ascending:false})
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const activate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("activate_driver_daily_pass");
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    onSuccess: () => {
      toast.success("₹99 Daily Pass activated — 0% commission for 24 hours.");
      qc.invalidateQueries({ queryKey: ["driver-daily-pass"] });
      qc.invalidateQueries({ queryKey: ["driver-wallet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="surface-card p-5">
      <div className="flex items-start gap-3">
        <Zap className="mt-0.5 h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl tracking-wide text-secondary">Daily Unlimited Pass</h2>
            {active.data && <Badge>ACTIVE</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Standard commission is 10% per completed trip. Buy the ₹99 pass once and get 0% commission for 24 hours.
          </p>
          {active.data ? (
            <p className="mt-2 text-xs font-semibold text-success">
              Active until {new Date(active.data.ends_at).toLocaleString("en-IN")}
            </p>
          ) : (
            <Button className="mt-3" onClick={() => activate.mutate()} disabled={activate.isPending}>
              {activate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Activate ₹99 pass
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
