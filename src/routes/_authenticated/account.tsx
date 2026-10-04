import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { ReferralCard } from "@/components/referrals/ReferralCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  FileText,
  Home,
  Loader2,
  LogOut,
  MapPin,
  Plus,
  ReceiptText,
  Trash2,
  Gift,
  Truck,
  User as UserIcon,
  Wallet,
  IndianRupee,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SupportChat } from "@/components/support/SupportChat";
import { vehicleLabel, BOOKING_FIELDS } from "@/lib/booking";
import { NotificationsCard } from "@/components/NotificationsCard";
import { DriverAccountProfile } from "@/components/driver/DriverAccountProfile";
import { AdminAccountProfile } from "@/components/admin/AdminAccountProfile";
import { signOutEverywhere } from "@/lib/session";
import { BecomeDriverCard } from "@/components/driver/BecomeDriverCard";
import { DeleteAccountCard } from "@/components/account/DeleteAccountCard";
import { CustomerProfileView } from "@/components/account/CustomerProfileView";
import { DriverProfileView } from "@/components/account/DriverProfileView";
import { DailyPassCard } from "@/components/driver/DailyPassCard";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "My account — MiniPort" },
      {
        name: "description",
        content: "Manage your MiniPort profile and account settings.",
      },
      { property: "og:title", content: "My account — MiniPort" },
      {
        property: "og:description",
        content: "Manage your MiniPort profile and account settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user, profile, roles: cachedRoles, activeMode, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  // Authoritative role check straight from the database on every visit, so a
  // stale cached role can never show customer-only sections to a driver.
  const freshRoles = useQuery({
    queryKey: ["account-roles", user?.id],
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as string);
    },
  });
  const roles: string[] = [...cachedRoles, ...(freshRoles.data ?? [])];
  const isAdmin = roles.includes("admin");

  // Account rendering is governed by the authoritative profiles.active_mode
  // value fetched directly from Supabase on every visit. Cached auth state or
  // stale driver/application rows must never change the profile view.
  const activeModeQuery = useQuery({
    queryKey: ["account-active-mode", user?.id],
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      if (!user?.id) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("profiles")
        .select("active_mode")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data.active_mode as "customer" | "driver";
    },
  });

  const authoritativeActiveMode = activeModeQuery.data ?? null;
  const isDriverProfile = !isAdmin && authoritativeActiveMode === "driver";
  const isCustomerProfile = !isAdmin && authoritativeActiveMode === "customer";
  const isDriverMode = isDriverProfile;
  const driverStateKnown =
    !authLoading && freshRoles.isSuccess && activeModeQuery.isSuccess;
  const showCustomerSections = driverStateKnown && isCustomerProfile;

  const monthlyDriverEarnings = useQuery({
    queryKey: ["driver-monthly-earnings", user?.id],
    enabled: Boolean(user?.id) && isDriverProfile && !isAdmin,
    queryFn: async () => {
      if (!user?.id) return [];
      const start = new Date();
      start.setMonth(start.getMonth() - 5, 1);
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("bookings")
        .select("id, fare, driver_net_earning, updated_at, created_at, status")
        .eq("driver_id", user.id)
        .eq("status", "completed")
        .gte("updated_at", start.toISOString())
        .limit(1000)
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const months = new Map<string, { label: string; earnings: number; rides: number }>();
      for (const booking of data ?? []) {
        const date = new Date(booking.updated_at ?? booking.created_at);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const current = months.get(key) ?? {
          label: date.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
          earnings: 0,
          rides: 0,
        };
        current.earnings += Number(booking.driver_net_earning ?? booking.fare ?? 0);
        current.rides += 1;
        months.set(key, current);
      }

      return Array.from(months.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([key, value]) => ({ key, ...value }));
    },
  });

  const addresses = useQuery({
    queryKey: ["saved-addresses", user?.id],
    enabled: Boolean(user?.id) && showCustomerSections,
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("saved_addresses")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const gstins = useQuery({
    queryKey: ["gstins", user?.id],
    enabled: Boolean(user?.id) && showCustomerSections,
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("customer_gstins")
        .select("*")
        .eq("user_id", user.id)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [gstOpen, setGstOpen] = useState(false);
  const [gstin, setGstin] = useState("");
  const [bizName, setBizName] = useState("");
  const [bizAddr, setBizAddr] = useState("");

  const saveName = useMutation({
    mutationFn: async (next: string) => {
      if (!user?.id) throw new Error("Please sign in again.");
      const { error } = await supabase.from("profiles").update({ name: next }).eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => toast.success("Profile updated"),
    onError: (e: Error) => toast.error(e.message),
  });

  const addGstin = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Please sign in again.");
      const code = gstin.trim().toUpperCase();
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(code))
        throw new Error("Enter a valid 15-character GSTIN");
      if (bizName.trim().length < 2) throw new Error("Enter the business name");
      const { error } = await supabase.from("customer_gstins").insert({
        user_id: user.id,
        gstin: code,
        business_name: bizName.trim(),
        business_address: bizAddr.trim() || null,
        is_default: (gstins.data ?? []).length === 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("GSTIN saved");
      setGstOpen(false);
      setGstin("");
      setBizName("");
      setBizAddr("");
      qc.invalidateQueries({ queryKey: ["gstins", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefaultGstin = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error("Please sign in again.");
      const { error: clearError } = await supabase
        .from("customer_gstins")
        .update({ is_default: false })
        .eq("user_id", user.id);
      if (clearError) throw clearError;
      const { error } = await supabase
        .from("customer_gstins")
        .update({ is_default: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gstins", user?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeGstin = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error("Please sign in again.");
      const { error } = await supabase.from("customer_gstins").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("GSTIN removed");
      qc.invalidateQueries({ queryKey: ["gstins", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeAddress = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error("Please sign in again.");
      const { error } = await supabase.from("saved_addresses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Address removed");
      qc.invalidateQueries({ queryKey: ["saved-addresses", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signOut = () => void signOutEverywhere(qc);

  useEffect(() => {
    if (!driverStateKnown) return;
    console.log("[MiniPort account]", {
      active_mode: activeMode,
      user_roles: roles,
      kyc_status: profile?.kyc_status ?? null,
      view: isAdmin ? "admin" : isDriverProfile ? "driver" : "customer",
    });
  }, [
    driverStateKnown,
    activeMode,
    roles.join(","),
    isDriverProfile,
    isAdmin,
  ]);

  if (freshRoles.isError || activeModeQuery.isError) {
    return (
      <div className="surface-card p-5 text-sm text-destructive">
        This screen could not load your account safely. Please refresh and try again.
      </div>
    );
  }

  // Never fall back to the customer view while roles/driver state are loading.
  if (!driverStateKnown) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading account">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const ProfileView = isAdmin ? Fragment : isDriverProfile ? DriverProfileView : CustomerProfileView;

  return (
    <ProfileView>
      <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-secondary">Account</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Admin identity, platform controls and sign-out."
            : isDriverProfile
              ? "Driver profile, vehicle documents and account settings."
              : "Profile, addresses, GST and invoices."}
        </p>
      </header>

      <section className="surface-card p-5">
        <div className="flex items-center gap-3">
          <div className="brand-gradient grid h-12 w-12 place-items-center rounded-full">
            <UserIcon className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-xl tracking-wide text-secondary">
              {profile?.name ?? "MiniPort user"}
            </p>
            <p className="text-sm text-muted-foreground">{profile?.phone}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="acc-name">Display name</Label>
            <Input
              id="acc-name"
              value={name || (profile?.name ?? "")}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>
          <Button
            onClick={() => saveName.mutate((name || profile?.name || "").trim())}
            disabled={saveName.isPending || !(name || "").trim()}
          >
            Save
          </Button>
          {!isAdmin && !isDriverProfile && (
            <Button variant="outline" asChild>
              <Link to="/refer">
                <Gift className="h-4 w-4" /> Refer & Earn
              </Link>
            </Button>
          )}
        </div>
      </section>

      {isAdmin && <AdminAccountProfile />}
      {isDriverProfile && !isAdmin && <DriverAccountProfile />}
      {isDriverProfile && !isAdmin && <DailyPassCard />}
      <NotificationsCard />
      {!isAdmin && <ReferralCard />}

      {isDriverProfile && !isAdmin && (
        <section className="surface-card p-5">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-display text-xl tracking-wide text-secondary">
                Monthly earnings &amp; rides
              </h2>
              <p className="text-xs text-muted-foreground">
                Completed rides and your net earning, month by month.
              </p>
            </div>
          </div>
          {monthlyDriverEarnings.isLoading ? (
            <Loader2 className="mt-4 h-4 w-4 animate-spin text-primary" />
          ) : monthlyDriverEarnings.isError ? (
            <p className="mt-4 text-sm text-destructive">Could not load monthly earnings.</p>
          ) : (monthlyDriverEarnings.data ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No completed rides in the last 6 months.
            </p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-md border">
              {(monthlyDriverEarnings.data ?? []).map((month) => (
                <div
                  key={month.key}
                  className="flex items-center justify-between gap-3 border-b p-3 last:border-b-0"
                >
                  <div>
                    <p className="text-sm font-semibold text-secondary">{month.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {month.rides} completed {month.rides === 1 ? "ride" : "rides"}
                    </p>
                  </div>
                  <p className="font-display text-lg text-success">₹{month.earnings.toFixed(0)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {showCustomerSections && (
        <>
          <section className="surface-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
                <ReceiptText className="h-4 w-4 text-primary" /> GST numbers
              </h2>
              <Dialog open={gstOpen} onOpenChange={setGstOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add a GSTIN</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="g-num">GSTIN</Label>
                      <Input
                        id="g-num"
                        value={gstin}
                        onChange={(e) => setGstin(e.target.value.toUpperCase())}
                        maxLength={15}
                        placeholder="06ABCDE1234F1Z5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="g-biz">Business name</Label>
                      <Input
                        id="g-biz"
                        value={bizName}
                        onChange={(e) => setBizName(e.target.value)}
                        maxLength={80}
                      />
                    </div>
                    <div>
                      <Label htmlFor="g-addr">Business address (optional)</Label>
                      <Input
                        id="g-addr"
                        value={bizAddr}
                        onChange={(e) => setBizAddr(e.target.value)}
                        maxLength={160}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => addGstin.mutate()} disabled={addGstin.isPending}>
                      {addGstin.isPending ? "Saving…" : "Save GSTIN"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {gstins.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (gstins.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No GSTIN saved. Add one to get GST tax invoices for business bookings.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {(gstins.data ?? []).map((g) => (
                  <li key={g.id} className="flex items-center gap-3 py-2.5">
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-secondary">
                        {g.business_name}
                      </p>
                      <p className="text-xs text-muted-foreground">{g.gstin}</p>
                    </div>
                    {g.is_default ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Default
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDefaultGstin.mutate(g.id)}
                      >
                        Set default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeGstin.mutate(g.id)}
                      aria-label="Remove GSTIN"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl tracking-wide text-secondary">Order history</h2>
                <p className="text-xs text-muted-foreground">
                  View your customer bookings, payments and completed orders.
                </p>
              </div>
              <Button size="sm" variant="outline" asChild>
                <Link to="/orders">Open orders</Link>
              </Button>
            </div>
          </section>

          <section className="surface-card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
              <MapPin className="h-4 w-4 text-primary" /> Saved addresses
            </h2>
            {addresses.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (addresses.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved addresses. Tap “Save address” while booking to store one.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {(addresses.data ?? []).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2.5">
                    <Home className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-secondary">
                        {a.alias || a.kind}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{a.address}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeAddress.mutate(a.id)}
                      aria-label="Remove address"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {user && !isDriverProfile && <BecomeDriverCard userId={user.id} />}

          <section className="surface-card space-y-2 p-5">
            <h2 className="font-display text-xl tracking-wide text-secondary">More</h2>
            <a
              className="flex w-full items-center justify-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              href="/privacy.html"
            >
              Privacy policy
            </a>
            <a
              className="flex w-full items-center justify-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              href="/terms.html"
            >
              Terms of service
            </a>
            <DeleteAccountCard />
            <Button
              variant="ghost"
              className="w-full justify-start text-destructive"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </section>
        </>
      )}

      {driverStateKnown && !showCustomerSections && (
        <section className="surface-card p-5">
          <h2 className="font-display text-xl tracking-wide text-secondary">Account actions</h2>
          <div className="mt-2 space-y-2">
            <a
              className="flex w-full items-center justify-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              href="/privacy.html"
            >
              Privacy policy
            </a>
            <a
              className="flex w-full items-center justify-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              href="/terms.html"
            >
              Terms of service
            </a>
            <DeleteAccountCard />
            <Button
              variant="ghost"
              className="w-full justify-start text-destructive"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </section>
      )}

      <SupportChat role={isDriverMode ? "driver" : "customer"} />
      </div>
    </ProfileView>
  );
}
