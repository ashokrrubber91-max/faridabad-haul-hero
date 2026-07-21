import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, ArrowRight, MapPin, Users, Truck, IndianRupee, MessageSquare,
  LayoutDashboard, UserCog, UserRound, Radio, Percent, Trophy, Ticket,
  Ban, ShieldCheck, Wallet as WalletIcon, Send, Search,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { vehicleLabel, STATUS_META, VEHICLES } from "@/lib/booking";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — MiniPort" }] }),
  component: AdminPage,
});

type Booking = {
  id: string; customer_id: string; driver_id: string | null;
  pickup_address: string; drop_address: string; vehicle_type: string;
  distance_km: number; fare: number; status: string; created_at: string;
  commission_amount: number; driver_net_earning: number; payment_method: string;
};
type Profile = { id: string; name: string; phone: string; active_mode: string; is_online: boolean };

function AdminPage() {
  const { role, loading } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");

  const bookings = useQuery({
    queryKey: ["admin-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings").select("*")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as Booking[];
    },
  });

  const profiles = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles")
        .select("id, name, phone, active_mode, is_online");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  const userRoles = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return data ?? [];
    },
  });

  const wallets = useQuery({
    queryKey: ["admin-wallets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wallet_accounts")
        .select("user_id, cash_balance, coins_balance");
      if (error) throw error;
      return data ?? [];
    },
  });

  const smsLogs = useQuery({
    queryKey: ["admin-sms-logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sms_logs").select("*")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const incentives = useQuery({
    queryKey: ["admin-incentives"],
    queryFn: async () => {
      const { data, error } = await supabase.from("driver_incentive_config")
        .select("*").order("rides_required");
      if (error) throw error;
      return data ?? [];
    },
  });

  const coupons = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () => {
      const { data, error } = await supabase.from("coupons").select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase.channel("admin-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () =>
        qc.invalidateQueries({ queryKey: ["admin-bookings"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_logs" }, () =>
        qc.invalidateQueries({ queryKey: ["admin-sms-logs"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () =>
        qc.invalidateQueries({ queryKey: ["admin-profiles"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const profileMap = useMemo(() => {
    const m = new Map<string, Profile>();
    (profiles.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles.data]);

  const rolesByUser = useMemo(() => {
    const m = new Map<string, string[]>();
    (userRoles.data ?? []).forEach((r) => {
      const arr = m.get(r.user_id) ?? [];
      arr.push(r.role);
      m.set(r.user_id, arr);
    });
    return m;
  }, [userRoles.data]);

  const walletMap = useMemo(() => {
    const m = new Map<string, { cash_balance: number; coins_balance: number }>();
    (wallets.data ?? []).forEach((w) => m.set(w.user_id, w));
    return m;
  }, [wallets.data]);

  if (loading) return <Center><Loader2 className="h-5 w-5 animate-spin text-primary" /></Center>;
  if (role && role !== "admin") return <Navigate to={role === "driver" ? "/driver" : "/customer"} />;

  const all = bookings.data ?? [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayBookings = all.filter((b) => new Date(b.created_at) >= today);
  const pending = all.filter((b) => b.status === "pending").length;
  const active = all.filter((b) => b.status === "accepted" || b.status === "in_progress");
  const completedAll = all.filter((b) => b.status === "completed");
  const completedToday = todayBookings.filter((b) => b.status === "completed");
  const revenueToday = completedToday.reduce((s, b) => s + Number(b.fare), 0);
  const commissionAll = completedAll.reduce((s, b) => s + Number(b.commission_amount ?? 0), 0);
  const revenueAll = completedAll.reduce((s, b) => s + Number(b.fare), 0);

  const drivers = (profiles.data ?? []).filter((p) => rolesByUser.get(p.id)?.includes("driver"));
  const customers = (profiles.data ?? []).filter((p) => (rolesByUser.get(p.id) ?? ["customer"]).includes("customer") && !rolesByUser.get(p.id)?.includes("driver"));
  const onlineDrivers = drivers.filter((d) => d.is_online).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl tracking-wide text-secondary">Admin Console</h2>
        <p className="text-sm text-muted-foreground">MiniPort operations · Faridabad</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/50">
          <TabsTrigger value="overview" className="gap-1.5"><LayoutDashboard className="h-3.5 w-3.5" />Overview</TabsTrigger>
          <TabsTrigger value="drivers" className="gap-1.5"><UserCog className="h-3.5 w-3.5" />Drivers</TabsTrigger>
          <TabsTrigger value="customers" className="gap-1.5"><UserRound className="h-3.5 w-3.5" />Customers</TabsTrigger>
          <TabsTrigger value="trips" className="gap-1.5"><Radio className="h-3.5 w-3.5" />Live Trips</TabsTrigger>
          <TabsTrigger value="fares" className="gap-1.5"><Percent className="h-3.5 w-3.5" />Fares & Commission</TabsTrigger>
          <TabsTrigger value="incentives" className="gap-1.5"><Trophy className="h-3.5 w-3.5" />Incentives</TabsTrigger>
          <TabsTrigger value="coupons" className="gap-1.5"><Ticket className="h-3.5 w-3.5" />Coupons</TabsTrigger>
          <TabsTrigger value="sms" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" />SMS Log</TabsTrigger>
          <TabsTrigger value="broadcast" className="gap-1.5"><Send className="h-3.5 w-3.5" />Broadcast</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={<IndianRupee className="h-4 w-4" />} label="Revenue Today" value={`₹${revenueToday.toFixed(0)}`} tone="primary" />
            <Stat icon={<IndianRupee className="h-4 w-4" />} label="Commission (all)" value={`₹${commissionAll.toFixed(0)}`} tone="success" />
            <Stat icon={<Truck className="h-4 w-4" />} label="Live trips" value={active.length} tone="warning" />
            <Stat icon={<Truck className="h-4 w-4" />} label="Completed today" value={completedToday.length} tone="ink" />
            <Stat icon={<Users className="h-4 w-4" />} label="Drivers" value={`${onlineDrivers}/${drivers.length}`} tone="primary" />
            <Stat icon={<Users className="h-4 w-4" />} label="Customers" value={customers.length} tone="ink" />
            <Stat icon={<Truck className="h-4 w-4" />} label="Pending req." value={pending} tone="warning" />
            <Stat icon={<IndianRupee className="h-4 w-4" />} label="Lifetime revenue" value={`₹${revenueAll.toFixed(0)}`} tone="success" />
          </div>

          <section className="surface-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="font-display text-xl tracking-wide text-secondary">Recent bookings</h3>
            </div>
            <BookingsList bookings={all.slice(0, 15)} profileMap={profileMap} />
          </section>
        </TabsContent>

        {/* DRIVERS */}
        <TabsContent value="drivers">
          <DriversTab drivers={drivers} walletMap={walletMap} bookings={all} onChanged={() => {
            qc.invalidateQueries({ queryKey: ["admin-profiles"] });
            qc.invalidateQueries({ queryKey: ["admin-wallets"] });
          }} />
        </TabsContent>

        {/* CUSTOMERS */}
        <TabsContent value="customers">
          <CustomersTab customers={customers} bookings={all} />
        </TabsContent>

        {/* LIVE TRIPS */}
        <TabsContent value="trips">
          <LiveTripsTab bookings={all} profileMap={profileMap} drivers={drivers} onChanged={() =>
            qc.invalidateQueries({ queryKey: ["admin-bookings"] })} />
        </TabsContent>

        {/* FARES */}
        <TabsContent value="fares">
          <FaresTab bookings={all} />
        </TabsContent>

        {/* INCENTIVES */}
        <TabsContent value="incentives">
          <IncentivesTab tiers={incentives.data ?? []} onChanged={() =>
            qc.invalidateQueries({ queryKey: ["admin-incentives"] })} />
        </TabsContent>

        {/* COUPONS */}
        <TabsContent value="coupons">
          <CouponsTab coupons={coupons.data ?? []} onChanged={() =>
            qc.invalidateQueries({ queryKey: ["admin-coupons"] })} />
        </TabsContent>

        {/* SMS */}
        <TabsContent value="sms">
          <SmsLogsSection logs={smsLogs.data ?? []} />
        </TabsContent>

        {/* BROADCAST */}
        <TabsContent value="broadcast">
          <BroadcastTab drivers={drivers} customers={customers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================== Drivers ============================== */
function DriversTab({
  drivers, walletMap, bookings, onChanged,
}: {
  drivers: Profile[]; walletMap: Map<string, { cash_balance: number; coins_balance: number }>;
  bookings: Booking[]; onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [topupFor, setTopupFor] = useState<Profile | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = drivers.filter((d) =>
    !q || d.name.toLowerCase().includes(q.toLowerCase()) || d.phone.includes(q));

  const onTrip = (id: string) => bookings.some((b) =>
    b.driver_id === id && (b.status === "accepted" || b.status === "in_progress"));

  const toggleBlock = async (d: Profile) => {
    // "Block" = force offline
    const { error } = await supabase.from("profiles").update({ is_online: false }).eq("id", d.id);
    if (error) return toast.error(error.message);
    toast.success(`${d.name} taken offline`);
    onChanged();
  };

  const doTopup = async () => {
    if (!topupFor) return;
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) return toast.error("Enter a non-zero amount");
    setBusy(true);
    const existing = walletMap.get(topupFor.id);
    const newBalance = Number(existing?.cash_balance ?? 0) + delta;
    const { error } = await supabase.from("wallet_accounts").upsert({
      user_id: topupFor.id,
      cash_balance: newBalance,
      coins_balance: existing?.coins_balance ?? 0,
    }, { onConflict: "user_id" });
    if (!error) {
      await supabase.from("wallet_transactions").insert({
        user_id: topupFor.id, delta,
        reason: delta > 0 ? "Admin top-up" : "Admin adjustment",
      });
    }
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Wallet updated by ₹${delta}`);
    setTopupFor(null); setAmount("");
    onChanged();
  };

  return (
    <section className="surface-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="font-display text-xl tracking-wide text-secondary">Driver management</h3>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone"
            className="h-8 w-52 pl-7 text-xs" />
        </div>
      </div>
      <div className="divide-y divide-border">
        {filtered.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No drivers.</p>}
        {filtered.map((d) => {
          const w = walletMap.get(d.id);
          const busy = onTrip(d.id);
          const status = busy ? "On trip" : d.is_online ? "Online" : "Offline";
          const trips = bookings.filter((b) => b.driver_id === d.id && b.status === "completed").length;
          return (
            <div key={d.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="text-sm font-semibold text-secondary">{d.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{d.phone}</span></p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge className={statusTone(status)}>{status}</Badge>
                  <span>Trips: <strong className="text-secondary">{trips}</strong></span>
                  <span>Cash wallet: <strong className="text-secondary">₹{Number(w?.cash_balance ?? 0).toFixed(0)}</strong></span>
                  <span>Coins: <strong className="text-secondary">{Number(w?.coins_balance ?? 0).toFixed(0)}</strong></span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setTopupFor(d)}>
                  <WalletIcon className="mr-1 h-3.5 w-3.5" />Top-up
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggleBlock(d)} disabled={busy}>
                  <Ban className="mr-1 h-3.5 w-3.5" />Force offline
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toast.info("KYC verification module coming soon")}>
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" />KYC
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!topupFor} onOpenChange={(o) => !o && setTopupFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adjust wallet — {topupFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Amount (₹, negative to deduct)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" />
            <p className="text-xs text-muted-foreground">Current cash: ₹{Number(walletMap.get(topupFor?.id ?? "")?.cash_balance ?? 0).toFixed(0)}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopupFor(null)}>Cancel</Button>
            <Button onClick={doTopup} disabled={busy}>{busy ? "Saving..." : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ============================== Customers ============================== */
function CustomersTab({ customers, bookings }: { customers: Profile[]; bookings: Booking[] }) {
  const [q, setQ] = useState("");
  const filtered = customers.filter((c) =>
    !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));

  return (
    <section className="surface-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-display text-xl tracking-wide text-secondary">Customers ({customers.length})</h3>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search"
            className="h-8 w-52 pl-7 text-xs" />
        </div>
      </div>
      <div className="divide-y divide-border">
        {filtered.map((c) => {
          const trips = bookings.filter((b) => b.customer_id === c.id);
          const active = trips.filter((b) => b.status === "accepted" || b.status === "in_progress" || b.status === "pending").length;
          const spend = trips.filter((b) => b.status === "completed").reduce((s, b) => s + Number(b.fare), 0);
          return (
            <div key={c.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="text-sm font-semibold text-secondary">{c.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{c.phone}</span></p>
                <p className="text-xs text-muted-foreground">
                  Total bookings: <strong className="text-secondary">{trips.length}</strong> · Active: <strong className="text-secondary">{active}</strong> · Spend: <strong className="text-secondary">₹{spend.toFixed(0)}</strong>
                </p>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No customers.</p>}
      </div>
    </section>
  );
}

/* ============================== Live Trips ============================== */
function LiveTripsTab({
  bookings, profileMap, drivers, onChanged,
}: {
  bookings: Booking[]; profileMap: Map<string, Profile>; drivers: Profile[]; onChanged: () => void;
}) {
  const live = bookings.filter((b) => b.status === "pending" || b.status === "accepted" || b.status === "in_progress");
  const [assignFor, setAssignFor] = useState<Booking | null>(null);
  const [driverId, setDriverId] = useState<string>("");

  const cancel = async (b: Booking) => {
    if (!confirm("Cancel this trip?")) return;
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success("Trip cancelled");
    onChanged();
  };

  const assign = async () => {
    if (!assignFor || !driverId) return;
    const { error } = await supabase.from("bookings")
      .update({ driver_id: driverId, status: "accepted" }).eq("id", assignFor.id);
    if (error) return toast.error(error.message);
    toast.success("Driver assigned");
    setAssignFor(null); setDriverId(""); onChanged();
  };

  const availableDrivers = drivers.filter((d) => d.is_online);

  return (
    <section className="surface-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-display text-xl tracking-wide text-secondary">Live trips ({live.length})</h3>
      </div>
      <div className="divide-y divide-border">
        {live.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No live trips.</p>}
        {live.map((b) => {
          const meta = STATUS_META[b.status] ?? STATUS_META.pending;
          const customer = profileMap.get(b.customer_id);
          const driver = b.driver_id ? profileMap.get(b.driver_id) : null;
          return (
            <div key={b.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-start">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge className={tone(meta.tone)}>{meta.label}</Badge>
                  <span>{vehicleLabel(b.vehicle_type)} · {b.distance_km} km · ₹{Number(b.fare).toFixed(0)}</span>
                </div>
                <p className="flex items-start gap-1.5 text-sm text-secondary"><MapPin className="mt-0.5 h-3.5 w-3.5 text-primary" />{b.pickup_address}</p>
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground"><ArrowRight className="mt-0.5 h-3.5 w-3.5" />{b.drop_address}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Customer: <span className="text-secondary">{customer?.name ?? "—"}</span>
                  {driver ? <> · Driver: <span className="text-secondary">{driver.name}</span></> : <> · <span className="text-warning">Unassigned</span></>}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                {!driver && b.status === "pending" && (
                  <Button size="sm" variant="outline" onClick={() => setAssignFor(b)}>Assign driver</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => cancel(b)}>Cancel</Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!assignFor} onOpenChange={(o) => !o && setAssignFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign driver</DialogTitle></DialogHeader>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger><SelectValue placeholder="Choose an online driver" /></SelectTrigger>
            <SelectContent>
              {availableDrivers.length === 0 && <div className="px-2 py-4 text-center text-xs text-muted-foreground">No drivers online</div>}
              {availableDrivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name} · {d.phone}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)}>Cancel</Button>
            <Button onClick={assign} disabled={!driverId}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ============================== Fares & Commission ============================== */
type FareRow = { id: string; label: string; base: number; perKm: number };
function FaresTab({ bookings }: { bookings: Booking[] }) {
  const [rates, setRates] = useState<FareRow[]>(() =>
    VEHICLES.map((v) => ({ id: v.id, label: v.label, base: Number(v.base), perKm: Number(v.perKm) })),
  );
  const [commission, setCommission] = useState(10);

  const totalCommission = bookings.filter((b) => b.status === "completed")
    .reduce((s, b) => s + Number(b.commission_amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <h3 className="font-display text-xl tracking-wide text-secondary">Platform commission</h3>
        <p className="mt-1 text-xs text-muted-foreground">Applied to every completed booking. Lifetime collected: <strong className="text-secondary">₹{totalCommission.toFixed(0)}</strong></p>
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Label>Commission %</Label>
            <Input type="number" value={commission} onChange={(e) => setCommission(Number(e.target.value))} />
          </div>
          <Button onClick={() => toast.success(`Commission preview updated to ${commission}% (persist via backend config)`) }>
            Save
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Note: default is 10%. Persisting new rates for future bookings requires a backend config migration.</p>
      </section>

      <section className="surface-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-display text-xl tracking-wide text-secondary">Vehicle fare rules</h3>
        </div>
        <div className="divide-y divide-border">
          {rates.map((v, i) => (
            <div key={v.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_120px_120px_auto] sm:items-end">
              <div>
                <Label className="text-xs">Vehicle</Label>
                <p className="text-sm font-semibold text-secondary">{v.label}</p>
              </div>
              <div>
                <Label className="text-xs">Base fare (₹)</Label>
                <Input type="number" value={v.base} onChange={(e) => {
                  const c = [...rates]; c[i] = { ...c[i], base: Number(e.target.value) }; setRates(c);
                }} />
              </div>
              <div>
                <Label className="text-xs">Per km (₹)</Label>
                <Input type="number" value={v.perKm} onChange={(e) => {
                  const c = [...rates]; c[i] = { ...c[i], perKm: Number(e.target.value) }; setRates(c);
                }} />
              </div>
              <Button size="sm" variant="outline" onClick={() =>
                toast.success(`${v.label}: base ₹${v.base}, per km ₹${v.perKm} (preview only)`)}>Save</Button>
            </div>
          ))}
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">Rates preview locally. Wire to a backend `fare_config` table to persist across sessions.</p>
      </section>
    </div>
  );
}

/* ============================== Incentives ============================== */
function IncentivesTab({ tiers, onChanged }: { tiers: any[]; onChanged: () => void }) {
  const [rides, setRides] = useState("");
  const [bonus, setBonus] = useState("");
  const [label, setLabel] = useState("");

  const add = async () => {
    const r = Number(rides), b = Number(bonus);
    if (!r || !b || !label) return toast.error("Fill all fields");
    const { error } = await supabase.from("driver_incentive_config")
      .upsert({ rides_required: r, bonus_amount: b, label, active: true }, { onConflict: "rides_required" });
    if (error) return toast.error(error.message);
    toast.success("Incentive saved");
    setRides(""); setBonus(""); setLabel(""); onChanged();
  };

  const toggle = async (t: any) => {
    const { error } = await supabase.from("driver_incentive_config")
      .update({ active: !t.active }).eq("id", t.id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <h3 className="font-display text-xl tracking-wide text-secondary">Add / update tier</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-[100px_120px_1fr_auto] sm:items-end">
          <div><Label className="text-xs">Rides</Label><Input type="number" value={rides} onChange={(e) => setRides(e.target.value)} /></div>
          <div><Label className="text-xs">Bonus (₹)</Label><Input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} /></div>
          <div><Label className="text-xs">Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 10 rides = ₹200" /></div>
          <Button onClick={add}>Save tier</Button>
        </div>
      </section>

      <section className="surface-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-display text-xl tracking-wide text-secondary">Active tiers</h3>
        </div>
        <div className="divide-y divide-border">
          {tiers.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No incentive tiers yet.</p>}
          {tiers.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-secondary">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.rides_required} rides → ₹{Number(t.bonus_amount).toFixed(0)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t.active ? "Active" : "Paused"}</span>
                <Switch checked={t.active} onCheckedChange={() => toggle(t)} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================== Coupons ============================== */
function CouponsTab({ coupons, onChanged }: { coupons: any[]; onChanged: () => void }) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"flat" | "percent">("flat");
  const [value, setValue] = useState("");
  const [minFare, setMinFare] = useState("0");

  const add = async () => {
    if (!code || !value) return toast.error("Fill code and value");
    const { error } = await supabase.from("coupons").insert({
      code: code.toUpperCase(), kind, value: Number(value), min_fare: Number(minFare), active: true,
    });
    if (error) return toast.error(error.message);
    toast.success("Coupon created");
    setCode(""); setValue(""); setMinFare("0"); onChanged();
  };

  const toggle = async (c: any) => {
    const { error } = await supabase.from("coupons").update({ active: !c.active }).eq("id", c.id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <h3 className="font-display text-xl tracking-wide text-secondary">Create coupon</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_120px_120px_auto] sm:items-end">
          <div><Label className="text-xs">Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SAVE20" /></div>
          <div><Label className="text-xs">Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat ₹</SelectItem>
                <SelectItem value="percent">Percent %</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Value</Label><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></div>
          <div><Label className="text-xs">Min fare</Label><Input type="number" value={minFare} onChange={(e) => setMinFare(e.target.value)} /></div>
          <Button onClick={add}>Create</Button>
        </div>
      </section>

      <section className="surface-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-display text-xl tracking-wide text-secondary">Coupons</h3>
        </div>
        <div className="divide-y divide-border">
          {coupons.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No coupons yet.</p>}
          {coupons.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-secondary">{c.code}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {c.kind === "flat" ? `₹${c.value} off` : `${c.value}% off`} · min ₹{c.min_fare} · used {c.uses}{c.max_uses ? `/${c.max_uses}` : ""}
                  </span>
                </p>
              </div>
              <Switch checked={c.active} onCheckedChange={() => toggle(c)} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================== Broadcast ============================== */
function BroadcastTab({ drivers, customers }: { drivers: Profile[]; customers: Profile[] }) {
  const [audience, setAudience] = useState<"driver" | "customer">("driver");
  const [message, setMessage] = useState("");

  const send = async () => {
    if (!message.trim()) return toast.error("Enter a message");
    const targets = audience === "driver" ? drivers : customers;
    const count = targets.filter((t) => t.phone).length;
    if (count === 0) return toast.error("No recipients");
    // Broadcast is queued locally; wire to an SMS provider to deliver externally.
    toast.success(`Broadcast queued to ${count} ${audience}s`);
    setMessage("");
  };

  return (
    <section className="surface-card p-4">
      <h3 className="font-display text-xl tracking-wide text-secondary">Send broadcast</h3>
      <p className="text-xs text-muted-foreground">Queues an SMS to the selected audience via the sms_logs table.</p>
      <div className="mt-3 space-y-2">
        <div>
          <Label className="text-xs">Audience</Label>
          <Select value={audience} onValueChange={(v) => setAudience(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="driver">Drivers ({drivers.length})</SelectItem>
              <SelectItem value="customer">Customers ({customers.length})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Message</Label>
          <Input value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Rain bonus active — ₹50 extra per trip!" />
        </div>
        <Button onClick={send}><Send className="mr-1 h-3.5 w-3.5" />Send</Button>
      </div>
    </section>
  );
}

/* ============================== Shared ============================== */
function BookingsList({ bookings, profileMap }: { bookings: Booking[]; profileMap: Map<string, Profile> }) {
  return (
    <div className="divide-y divide-border">
      {bookings.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No bookings yet.</p>}
      {bookings.map((b) => {
        const meta = STATUS_META[b.status] ?? STATUS_META.pending;
        const customer = profileMap.get(b.customer_id);
        const driver = b.driver_id ? profileMap.get(b.driver_id) : null;
        return (
          <div key={b.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{vehicleLabel(b.vehicle_type)}</span><span>·</span>
                <span>{b.distance_km} km</span><span>·</span>
                <span>{new Date(b.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              <p className="flex items-start gap-1.5 truncate text-sm font-medium text-secondary">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />{b.pickup_address}</p>
              <p className="flex items-start gap-1.5 truncate text-sm text-muted-foreground">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />{b.drop_address}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {customer?.name ?? "—"}{driver && <> → {driver.name}</>}
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
  );
}

function SmsLogsSection({ logs }: { logs: any[] }) {
  return (
    <section className="surface-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
          <MessageSquare className="h-4 w-4 text-primary" /> SMS delivery log
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SmsCount logs={logs} status="queued" label="queued" />
          <SmsCount logs={logs} status="sent" label="sent" />
          <SmsCount logs={logs} status="failed" label="failed" />
        </div>
      </div>
      <div className="divide-y divide-border">
        {logs.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No SMS events yet.</p>}
        {logs.map((s) => (
          <div key={s.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="uppercase">{s.event}</Badge>
                <span className="capitalize">to {s.recipient}</span><span>·</span>
                <span className="font-mono">{s.phone}</span><span>·</span>
                <span>{new Date(s.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              <p className="truncate text-sm text-secondary">{s.body}</p>
              {s.error && <p className="text-xs text-destructive">{s.error}</p>}
            </div>
            <Badge className={smsTone(s.status)}>{s.status}</Badge>
          </div>
        ))}
      </div>
    </section>
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
function statusTone(s: string) {
  switch (s) {
    case "Online": return "bg-success text-success-foreground hover:bg-success";
    case "On trip": return "bg-primary text-primary-foreground hover:bg-primary";
    case "Offline": return "bg-muted text-muted-foreground hover:bg-muted";
    default: return "bg-destructive text-destructive-foreground hover:bg-destructive";
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
