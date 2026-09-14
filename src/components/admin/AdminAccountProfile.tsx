import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Percent, ShieldCheck, Users, Wallet as WalletIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { signOutEverywhere } from "@/lib/session";

/**
 * Operations identity for an admin account. Deliberately holds no customer
 * fields (GSTIN, saved addresses) and no driver documents — an admin books
 * nothing and drives nothing from this screen.
 */
export function AdminAccountProfile() {
  const { user, profile, roles } = useAuth();
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ["admin-profile-settings"],
    queryFn: async () => {
      const [{ data: commission }, { data: adminRows }, { data: pendingKyc }] = await Promise.all([
        supabase.from("platform_settings").select("commission_rate, updated_at").maybeSingle(),
        supabase.from("user_roles").select("user_id").eq("role", "admin"),
        supabase.from("driver_kyc").select("driver_id").eq("status", "pending"),
      ]);
      return {
        commissionRate: Number(commission?.commission_rate ?? 0),
        commissionUpdatedAt: commission?.updated_at ?? null,
        adminCount: (adminRows ?? []).length,
        pendingKyc: (pendingKyc ?? []).length,
      };
    },
  });

  return (
    <section className="surface-card p-5">
      <div className="flex items-start gap-3">
        <div className="brand-gradient grid h-11 w-11 shrink-0 place-items-center rounded-full">
          <ShieldCheck className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl tracking-wide text-secondary">Admin account</h2>
          <p className="text-xs text-muted-foreground">
            Operations identity and platform controls. Customer billing details and driver documents
            are not part of an admin profile.
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Admin name" value={profile?.name || "—"} />
        <Field label="Sign-in phone" value={profile?.phone || "—"} />
        <Field label="Account email" value={user?.email ?? "—"} />
        <Field label="Operating zone" value={profile?.service_zone || "Faridabad"} />
        <div className="rounded-md border p-3">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Roles held</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {roles.length === 0 ? (
              <span className="text-sm text-muted-foreground">—</span>
            ) : (
              roles.map((r) => (
                <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
                  {r}
                </Badge>
              ))
            )}
          </dd>
        </div>
        <Field
          label="Platform commission"
          value={
            settings.isLoading
              ? "Loading…"
              : `${Math.round((settings.data?.commissionRate ?? 0) * 100)}%`
          }
        />
      </dl>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Button variant="outline" className="justify-start" asChild>
          <Link to="/admin">
            <Users className="h-4 w-4" /> Operations console
          </Link>
        </Button>
        <Button variant="outline" className="justify-start" asChild>
          <Link to="/admin">
            <ShieldCheck className="h-4 w-4" /> KYC review
            {settings.data?.pendingKyc ? ` (${settings.data.pendingKyc})` : ""}
          </Link>
        </Button>
        <Button variant="outline" className="justify-start" asChild>
          <Link to="/admin">
            <Percent className="h-4 w-4" /> Fares & commission
          </Link>
        </Button>
        <Button variant="outline" className="justify-start" asChild>
          <Link to="/admin">
            <WalletIcon className="h-4 w-4" /> Payouts
          </Link>
        </Button>
      </div>

      <div className="mt-4 border-t pt-4">
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive"
          onClick={() => void signOutEverywhere(qc)}
        >
          <LogOut className="h-4 w-4" /> Log out of admin
        </Button>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-secondary">{value}</dd>
    </div>
  );
}
