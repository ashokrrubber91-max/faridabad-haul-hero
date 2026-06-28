import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowRight, MapPin, Users, Truck, IndianRupee, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { vehicleLabel, STATUS_META } from "@/lib/booking";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — MiniPort" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { role, loading } = useAuth();
  const qc = useQueryClient();

  const bookings = useQuery({
    queryKey: ["admin-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const profiles = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, name, phone");
      if (error) throw error;
      return data ?? [];
    },
  });

  const smsLogs = useQuery({
    queryKey: ["admin-sms-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sms_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("admin-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () =>
        qc.invalidateQueries({ queryKey: ["admin-bookings"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_logs" }, () =>
        qc.invalidateQueries({ queryKey: ["admin-sms-logs"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const profileMap = useMemo(() => {
    const m = new Map<string, { name: string; phone: string }>();
    (profiles.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles.data]);

  if (loading) return <Center><Loader2 className="h-5 w-5 animate-spin text-primary" /></Center>;
  if (role && role !== "admin") return <Navigate to={role === "driver" ? "/driver" : "/customer"} />;

  const all = bookings.data ?? [];
  const pending = all.filter((b) => b.status === "pending").length;
  const active = all.filter((b) => b.status === "accepted" || b.status === "in_progress").length;
  const completed = all.filter((b) => b.status === "completed");
  const revenue = completed.reduce((s, b) => s + Number(b.fare), 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl tracking-wide text-secondary">Admin dashboard</h2>
        <p className="text-sm text-muted-foreground">Live operations across Faridabad</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Truck className="h-4 w-4" />} label="Pending" value={pending} tone="warning" />
        <Stat icon={<Truck className="h-4 w-4" />} label="Active" value={active} tone="primary" />
        <Stat icon={<Truck className="h-4 w-4" />} label="Completed" value={completed.length} tone="success" />
        <Stat icon={<IndianRupee className="h-4 w-4" />} label="Revenue" value={`₹${revenue.toFixed(0)}`} tone="ink" />
      </div>

      <section className="surface-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-display text-xl tracking-wide text-secondary">All bookings</h3>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{profiles.data?.length ?? 0} users</span>
        </div>
        <div className="divide-y divide-border">
          {all.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No bookings yet.</p>}
          {all.map((b) => {
            const meta = STATUS_META[b.status] ?? STATUS_META.pending;
            const customer = profileMap.get(b.customer_id);
            const driver = b.driver_id ? profileMap.get(b.driver_id) : null;
            return (
              <div key={b.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{vehicleLabel(b.vehicle_type)}</span>
                    <span>·</span>
                    <span>{b.distance_km} km</span>
                    <span>·</span>
                    <span>{new Date(b.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                  <p className="flex items-start gap-1.5 truncate text-sm font-medium text-secondary">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />{b.pickup_address}
                  </p>
                  <p className="flex items-start gap-1.5 truncate text-sm text-muted-foreground">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />{b.drop_address}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Customer: <span className="text-secondary">{customer?.name ?? "—"}</span> ({customer?.phone ?? "—"})
                    {driver && <> · Driver: <span className="text-secondary">{driver.name}</span> ({driver.phone})</>}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                  <p className="font-display text-xl text-secondary">₹{Number(b.fare).toFixed(0)}</p>
                  <Badge className={tone(meta.tone)}>{meta.label}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="surface-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
            <MessageSquare className="h-4 w-4 text-primary" /> SMS delivery log
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <SmsCount logs={smsLogs.data ?? []} status="queued" label="queued" />
            <SmsCount logs={smsLogs.data ?? []} status="sent" label="sent" />
            <SmsCount logs={smsLogs.data ?? []} status="failed" label="failed" />
          </div>
        </div>
        <div className="divide-y divide-border">
          {(smsLogs.data ?? []).length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No SMS events yet. Logs appear when bookings are accepted, started, or completed.</p>
          )}
          {(smsLogs.data ?? []).map((s) => (
            <div key={s.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="uppercase">{s.event}</Badge>
                  <span className="capitalize">to {s.recipient}</span>
                  <span>·</span>
                  <span className="font-mono">{s.phone}</span>
                  <span>·</span>
                  <span>{new Date(s.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
                <p className="truncate text-sm text-secondary">{s.body}</p>
                {s.error && <p className="text-xs text-destructive">{s.error}</p>}
              </div>
              <div className="flex items-center justify-end gap-2 sm:flex-col sm:items-end">
                <Badge className={smsTone(s.status)}>{s.status}</Badge>
                {s.sent_at && (
                  <span className="text-[10px] text-muted-foreground">
                    sent {new Date(s.sent_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SmsCount({ logs, status, label }: { logs: Array<{ status: string }>; status: string; label: string }) {
  const n = logs.filter((l) => l.status === status).length;
  return <span><strong className="text-secondary">{n}</strong> {label}</span>;
}

function smsTone(s: string) {
  switch (s) {
    case "sent": return "bg-success text-success-foreground hover:bg-success";
    case "failed": return "bg-destructive text-destructive-foreground hover:bg-destructive";
    default: return "bg-warning text-warning-foreground hover:bg-warning";
  }
}


function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: "warning" | "primary" | "success" | "ink" }) {
  const map = {
    warning: "bg-warning text-warning-foreground",
    primary: "bg-primary text-primary-foreground",
    success: "bg-success text-success-foreground",
    ink: "bg-secondary text-secondary-foreground",
  } as const;
  return (
    <div className={`rounded-lg p-4 ${map[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider opacity-90">{icon}{label}</div>
      <p className="font-display text-3xl">{value}</p>
    </div>
  );
}

function tone(t: "warning" | "primary" | "success" | "muted" | "destructive") {
  switch (t) {
    case "warning": return "bg-warning text-warning-foreground hover:bg-warning";
    case "primary": return "bg-primary text-primary-foreground hover:bg-primary";
    case "success": return "bg-success text-success-foreground hover:bg-success";
    case "destructive": return "bg-destructive text-destructive-foreground hover:bg-destructive";
    default: return "";
  }
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-center py-10">{children}</div>;
}
