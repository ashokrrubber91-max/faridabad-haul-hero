import type { AnyRow } from "@/lib/rows";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  BadgeIndianRupee,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { vehicleLabel } from "@/lib/booking";

const PAGE = 25;

function money(n: number | null | undefined) {
  return `₹${Number(n ?? 0).toFixed(0)}`;
}
function when(v: string | null | undefined) {
  return v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function Shell({
  title,
  subtitle,
  query,
  children,
  toolbar,
}: {
  title: string;
  subtitle: string;
  query: {
    isLoading: boolean;
    isError: boolean;
    error?: unknown;
    refetch: () => void;
    isFetching?: boolean;
  };
  children: React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  return (
    <section className="surface-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="font-display text-xl tracking-wide text-secondary">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {toolbar}
          <Button
            size="sm"
            variant="outline"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />{" "}
            Refresh
          </Button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : query.isError ? (
        <div className="p-6 text-center text-sm">
          <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-destructive" />
          <p className="text-muted-foreground">
            {(query.error as Error | undefined)?.message ?? "Could not load this list."}
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Withdrawals                                                         */
/* ------------------------------------------------------------------ */

export function WithdrawalsTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const rows = useQuery({
    queryKey: ["admin-withdrawals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("withdrawal_requests")
        .select("id, driver_id, amount, method, status, note, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const driverIds = useMemo(
    () => Array.from(new Set((rows.data ?? []).map((r) => r.driver_id))),
    [rows.data],
  );

  const people = useQuery({
    queryKey: ["admin-withdrawal-people", driverIds.join(",")],
    enabled: driverIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, name, phone")
        .in("id", driverIds);
      const map: Record<string, { name: string; phone: string }> = {};
      (data ?? []).forEach((p) => (map[p.id] = { name: p.name, phone: p.phone }));
      return map;
    },
  });

  const banks = useQuery({
    queryKey: ["admin-withdrawal-banks", driverIds.join(",")],
    enabled: driverIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("driver_bank_accounts")
        .select("driver_id, account_holder, account_number, ifsc, bank_name, upi_id, is_default")
        .in("driver_id", driverIds);
      const map: Record<string, NonNullable<typeof data>[number]> = {};
      (data ?? []).forEach((b) => {
        if (!map[b.driver_id] || b.is_default) map[b.driver_id] = b;
      });
      return map;
    },
  });

  const settle = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "paid" | "rejected" }) => {
      const { error } = await supabase.from("withdrawal_requests").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(
        v.status === "paid" ? "Marked as paid out" : "Rejected — amount returned to the driver",
      );
      qc.invalidateQueries({ queryKey: ["admin-withdrawals"] });
      qc.invalidateQueries({ queryKey: ["admin-wallets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = (rows.data ?? []).filter((r) => {
    if (!q.trim()) return true;
    const p = people.data?.[r.driver_id];
    const needle = q.toLowerCase();
    return (
      p?.name?.toLowerCase().includes(needle) ||
      p?.phone?.includes(q.trim()) ||
      r.status.includes(needle)
    );
  });
  const pendingTotal = (rows.data ?? [])
    .filter((r) => r.status === "requested")
    .reduce((s, r) => s + Number(r.amount), 0);

  return (
    <Shell
      title="Driver payouts"
      subtitle={`${(rows.data ?? []).filter((r) => r.status === "requested").length} awaiting action · ${money(pendingTotal)} on hold`}
      query={rows}
      toolbar={
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Driver or status"
            className="h-9 w-40 pl-7 text-xs sm:w-56"
          />
        </div>
      }
    >
      {list.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No payout requests.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((r) => {
            const p = people.data?.[r.driver_id];
            const bank = banks.data?.[r.driver_id];
            return (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-secondary">
                    {p?.name ?? "Driver"}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {p?.phone ?? ""}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {when(r.created_at)} · {r.method}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                  {bank ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {bank.upi_id
                        ? `UPI ${bank.upi_id}`
                        : `${bank.bank_name} · ${bank.account_holder} · ****${String(bank.account_number).slice(-4)} · ${bank.ifsc}`}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-destructive">No payout method saved</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-display text-lg text-secondary">{money(r.amount)}</span>
                  {r.status === "requested" ? (
                    <>
                      <Button
                        size="sm"
                        disabled={settle.isPending}
                        onClick={() => settle.mutate({ id: r.id, status: "paid" })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Paid
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={settle.isPending}
                        onClick={() => settle.mutate({ id: r.id, status: "rejected" })}
                      >
                        <Ban className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </>
                  ) : (
                    <Badge variant={r.status === "paid" ? "secondary" : "destructive"}>
                      {r.status}
                    </Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Disputes, cancellations & refunds                                   */
/* ------------------------------------------------------------------ */

type DisputeBooking = {
  id: string;
  customer_id: string;
  driver_id: string | null;
  pickup_address: string;
  drop_address: string;
  vehicle_type: string;
  fare: number;
  status: string;
  payment_status: string;
  payment_method: string;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  rating: number | null;
  review: string | null;
  created_at: string;
};

export function DisputesTab({
  profileMap,
}: {
  profileMap: Map<string, { name: string; phone: string }>;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const rows = useQuery({
    queryKey: ["admin-disputes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          "id, customer_id, driver_id, pickup_address, drop_address, vehicle_type, fare, status, payment_status, payment_method, cancellation_reason, cancelled_at, rating, review, created_at",
        )
        .or("status.eq.cancelled,rating.lte.2")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as DisputeBooking[];
    },
  });

  const refund = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bookings")
        .update({ payment_status: "refunded" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as refunded");
      qc.invalidateQueries({ queryKey: ["admin-disputes"] });
      qc.invalidateQueries({ queryKey: ["admin-bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (rows.data ?? []).filter((b) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    const c = profileMap.get(b.customer_id);
    return (
      b.pickup_address.toLowerCase().includes(needle) ||
      b.drop_address.toLowerCase().includes(needle) ||
      (b.cancellation_reason ?? "").toLowerCase().includes(needle) ||
      (c?.name ?? "").toLowerCase().includes(needle) ||
      (c?.phone ?? "").includes(q.trim())
    );
  });

  return (
    <Shell
      title="Cancellations & complaints"
      subtitle={`${(rows.data ?? []).filter((b) => b.status === "cancelled").length} cancelled · ${(rows.data ?? []).filter((b) => (b.rating ?? 5) <= 2).length} low ratings`}
      query={rows}
      toolbar={
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Customer, address, reason"
            className="h-9 w-44 pl-7 text-xs sm:w-64"
          />
        </div>
      }
    >
      {filtered.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          Nothing to review — no cancellations or complaints.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {filtered.slice(0, limit).map((b) => {
              const c = profileMap.get(b.customer_id);
              const d = b.driver_id ? profileMap.get(b.driver_id) : null;
              return (
                <li key={b.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        CRN {b.id.slice(0, 8).toUpperCase()} · {when(b.created_at)}
                      </p>
                      <p className="truncate text-sm font-medium text-secondary">
                        {b.pickup_address} → {b.drop_address}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {vehicleLabel(b.vehicle_type)} · {c?.name ?? "Customer"} {c?.phone ?? ""}
                        {d ? ` · Driver ${d.name}` : " · No driver"}
                      </p>
                      {b.cancellation_reason && (
                        <p className="mt-1 text-xs text-destructive">
                          Reason: {b.cancellation_reason}
                        </p>
                      )}
                      {b.review && (
                        <p className="mt-1 text-xs italic text-muted-foreground">“{b.review}”</p>
                      )}
                    </div>
                    <div className="shrink-0 space-y-1 text-right">
                      <p className="font-display text-lg text-secondary">{money(b.fare)}</p>
                      <Badge variant={b.status === "cancelled" ? "destructive" : "secondary"}>
                        {b.status}
                      </Badge>
                      <p className="text-[11px] text-muted-foreground">
                        {b.payment_method.toUpperCase()} · {b.payment_status}
                      </p>
                      {b.rating ? (
                        <p className="text-[11px] text-warning-foreground">
                          {"★".repeat(b.rating)}
                        </p>
                      ) : null}
                      {b.payment_status === "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={refund.isPending}
                          onClick={() => refund.mutate(b.id)}
                        >
                          <BadgeIndianRupee className="h-3.5 w-3.5" /> Mark refunded
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {filtered.length > limit && (
            <div className="border-t border-border p-3 text-center">
              <Button size="sm" variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
                Show more ({filtered.length - limit} left)
              </Button>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Audit trail & security alerts                                       */
/* ------------------------------------------------------------------ */

export function AuditTab({
  profileMap,
}: {
  profileMap: Map<string, { name: string; phone: string }>;
}) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const logs = useQuery({
    queryKey: ["admin-audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, actor_id, action, table_name, row_id, created_at")
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw error;
      return data ?? [];
    },
  });

  const lockouts = useQuery({
    queryKey: ["admin-otp-lockouts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_otp_attempts")
        .select("booking_id, stage, attempts, locked_until, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const failedPayments = useQuery({
    queryKey: ["admin-failed-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, booking_id, customer_id, amount, state, error, created_at")
        .in("state", ["failed", "refunded"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = (logs.data ?? []).filter((l) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    const actor = l.actor_id ? profileMap.get(l.actor_id) : null;
    return (
      l.table_name.toLowerCase().includes(needle) ||
      l.action.toLowerCase().includes(needle) ||
      (actor?.name ?? "").toLowerCase().includes(needle) ||
      (actor?.phone ?? "").includes(q.trim())
    );
  });

  return (
    <div className="space-y-4">
      <section className="surface-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
            <ShieldAlert className="h-4 w-4 text-destructive" /> Security alerts
          </h3>
          <p className="text-xs text-muted-foreground">
            Repeated wrong delivery codes and failed or refunded payments.
          </p>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Code lockouts
            </p>
            {lockouts.isLoading ? (
              <Loader2 className="mt-2 h-4 w-4 animate-spin text-primary" />
            ) : (lockouts.data ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No wrong-code activity.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {(lockouts.data ?? []).map((l) => (
                  <li key={`${l.booking_id}-${l.stage}`} className="flex justify-between gap-2">
                    <span className="truncate text-secondary">
                      CRN {l.booking_id.slice(0, 8).toUpperCase()} · {l.stage}
                    </span>
                    <span className={l.locked_until ? "text-destructive" : "text-muted-foreground"}>
                      {l.attempts} tries{l.locked_until ? " · locked" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Failed / refunded payments
            </p>
            {failedPayments.isLoading ? (
              <Loader2 className="mt-2 h-4 w-4 animate-spin text-primary" />
            ) : (failedPayments.data ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No failed payments.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {(failedPayments.data ?? []).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span className="truncate text-secondary">
                      {money(p.amount)} · {profileMap.get(p.customer_id)?.name ?? "Customer"}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {p.state}
                      {p.error ? ` · ${p.error.slice(0, 30)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <Shell
        title="Activity trail"
        subtitle="Every change to bookings, payments, roles, payout methods and withdrawals."
        query={logs}
        toolbar={
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Table, action or person"
              className="h-9 w-40 pl-7 text-xs sm:w-56"
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-border text-xs">
              {filtered.slice(0, limit).map((l) => {
                const actor = l.actor_id ? profileMap.get(l.actor_id) : null;
                return (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                  >
                    <span className="text-secondary">
                      <span className="font-semibold">{l.action}</span> on {l.table_name}
                      {l.row_id ? ` · ${l.row_id.slice(0, 8).toUpperCase()}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {actor ? `${actor.name} · ` : "system · "}
                      {when(l.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {filtered.length > limit && (
              <div className="border-t border-border p-3 text-center">
                <Button size="sm" variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
                  Show more ({filtered.length - limit} left)
                </Button>
              </div>
            )}
          </>
        )}
      </Shell>
    </div>
  );
}
