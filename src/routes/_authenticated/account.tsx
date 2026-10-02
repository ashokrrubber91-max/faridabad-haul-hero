import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const AdminAccountProfile = lazy(() => import("@/components/admin/AdminAccountProfile").then((m) => ({ default: m.AdminAccountProfile })));
const CustomerProfileView = lazy(() => import("@/components/profile/CustomerProfileView").then((m) => ({ default: m.CustomerProfileView })));
const DriverProfileView = lazy(() => import("@/components/profile/DriverProfileView").then((m) => ({ default: m.DriverProfileView })));

function ProfileLoader() { return <div className="space-y-4"><div className="h-10 animate-pulse rounded-md bg-muted" /><div className="h-48 animate-pulse rounded-md bg-muted" /></div>; }

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "My account — MiniPort" },
      { name: "description", content: "Manage your MiniPort profile and account settings." },
      { property: "og:title", content: "My account — MiniPort" },
      { property: "og:description", content: "Manage your MiniPort profile and account settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountPage,
});

/**
 * Account is a strict role router.
 *
 * Customer and Driver UIs are isolated in separate components. The router uses
 * only the freshly-read authoritative role rows and active_mode; cached auth
 * roles are deliberately NOT merged into the decision because a stale driver
 * role must never cause customer fields to bleed into the Driver interface.
 */
function AccountPage() {
  const { user, profile, activeMode, loading: authLoading } = useAuth();

  const accountAuthority = useQuery({
    queryKey: ["account-authority", user?.id],
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const [{ data: roleRows, error: roleError }, { data: profileRow, error: profileError }] =
        await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", user!.id),
          supabase.from("profiles").select("active_mode").eq("id", user!.id).maybeSingle(),
        ]);

      if (roleError) throw roleError;
      if (profileError) throw profileError;

      const roles = Array.from(new Set((roleRows ?? []).map((row) => String(row.role))));
      const active = String(profileRow?.active_mode ?? profile?.active_mode ?? activeMode ?? "");

      return { roles, activeMode: active };
    },
  });

  if (!user || authLoading || accountAuthority.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (accountAuthority.isError) {
    return (
      <div className="surface-card p-5 text-sm text-destructive">
        Could not verify your account role. Please refresh and try again.
      </div>
    );
  }

  const roles = accountAuthority.data?.roles ?? [];
  const authoritativeMode = accountAuthority.data?.activeMode ?? "";

  // Admin is a separate interface and never falls through to Customer/Driver.
  if (roles.includes("admin")) {
    return (<ErrorBoundary label="admin-account"><Suspense fallback={<ProfileLoader />}><AdminAccountProfile /></Suspense></ErrorBoundary>);
  }

  const hasDriverRole = roles.includes("driver");
  const hasCustomerRole = roles.includes("customer");

  // Exact role/mode matching:
  // - driver-only accounts => Driver
  // - customer-only accounts => Customer
  // - dual-mode accounts => active_mode decides
  // - unknown/stale combinations => render neither profile
  const isDriver =
    hasDriverRole && (!hasCustomerRole || authoritativeMode === "driver");
  const isCustomer =
    hasCustomerRole && (!hasDriverRole || authoritativeMode === "customer");

  if (isDriver && !isCustomer) return (<ErrorBoundary label="driver-account"><Suspense fallback={<ProfileLoader />}><DriverProfileView /></Suspense></ErrorBoundary>);

  if (isCustomer && !isDriver) return (<ErrorBoundary label="customer-account"><Suspense fallback={<ProfileLoader />}><CustomerProfileView /></Suspense></ErrorBoundary>);

  return (
    <div className="surface-card p-5 text-sm text-muted-foreground">
      Your account role/mode is not available yet. Please sign out and sign in again.
    </div>
  );
}
