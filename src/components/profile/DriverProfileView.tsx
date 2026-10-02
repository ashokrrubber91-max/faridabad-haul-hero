import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, User as UserIcon, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NotificationsCard } from "@/components/NotificationsCard";
import { DriverAccountProfile } from "@/components/driver/DriverAccountProfile";
import { DeleteAccountCard } from "@/components/account/DeleteAccountCard";
import { SupportChat } from "@/components/support/SupportChat";
import { signOutEverywhere } from "@/lib/session";

export function DriverProfileView() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");

  const monthlyDriverEarnings = useQuery({
    queryKey: ["driver-profile-monthly-earnings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const start = new Date();
      start.setMonth(start.getMonth() - 5, 1);
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("bookings")
        .select("id, fare, driver_net_earning, updated_at, created_at, status")
        .eq("driver_id", user!.id)
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

  const saveName = useMutation({
    mutationFn: async (next: string) => {
      const { error } = await supabase.from("profiles").update({ name: next }).eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => toast.success("Profile updated"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!user) return null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-secondary">Driver account</h1>
        <p className="text-sm text-muted-foreground">Driver profile, vehicle documents, earnings and account settings.</p>
      </header>

      <section className="surface-card p-5">
        <div className="flex items-center gap-3">
          <div className="brand-gradient grid h-12 w-12 place-items-center rounded-full"><UserIcon className="h-6 w-6 text-white" /></div>
          <div className="min-w-0">
            <p className="truncate font-display text-xl tracking-wide text-secondary">{profile?.name ?? "MiniPort driver"}</p>
            <p className="text-sm text-muted-foreground">{profile?.phone}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="driver-name">Display name</Label>
            <Input id="driver-name" value={name || (profile?.name ?? "")} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <Button onClick={() => saveName.mutate((name || profile?.name || "").trim())} disabled={saveName.isPending || !(name || "").trim()}>Save</Button>
        </div>
      </section>

      <DriverAccountProfile />
      <NotificationsCard />

      <section className="surface-card p-5">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-display text-xl tracking-wide text-secondary">Monthly earnings &amp; rides</h2>
            <p className="text-xs text-muted-foreground">Completed rides and your net earning, month by month.</p>
          </div>
        </div>
        {monthlyDriverEarnings.isLoading ? (
          <Loader2 className="mt-4 h-4 w-4 animate-spin text-primary" />
        ) : monthlyDriverEarnings.isError ? (
          <p className="mt-4 text-sm text-destructive">Could not load monthly earnings.</p>
        ) : (monthlyDriverEarnings.data ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No completed rides in the last 6 months.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-md border">
            {(monthlyDriverEarnings.data ?? []).map((month) => (
              <div key={month.key} className="flex items-center justify-between gap-3 border-b p-3 last:border-b-0">
                <div>
                  <p className="text-sm font-semibold text-secondary">{month.label}</p>
                  <p className="text-xs text-muted-foreground">{month.rides} completed {month.rides === 1 ? "ride" : "rides"}</p>
                </div>
                <p className="font-display text-lg text-success">₹{month.earnings.toFixed(0)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="surface-card p-5">
        <h2 className="font-display text-xl tracking-wide text-secondary">Account actions</h2>
        <div className="mt-2 space-y-2">
          <a className="flex w-full items-center justify-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted" href="/privacy.html">Privacy policy</a>
          <a className="flex w-full items-center justify-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted" href="/terms.html">Terms of service</a>
          <DeleteAccountCard />
          <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => void signOutEverywhere(qc)}><LogOut className="h-4 w-4" /> Sign out</Button>
        </div>
      </section>

      <SupportChat role="driver" />
    </div>
  );
}
