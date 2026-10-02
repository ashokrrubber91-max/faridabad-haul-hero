import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AdminAccountProfile } from "@/components/admin/AdminAccountProfile";
import { CustomerProfileView } from "@/components/profile/CustomerProfileView";
import { DriverProfileView } from "@/components/profile/DriverProfileView";

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
 * Account is intentionally only a role router.
 *
 * Customer and Driver profile UIs are isolated in separate components so a
 * stale query, active-mode switch, or conditional branch can never render
 * customer fields inside the driver profile (or vice versa).
 */
function AccountPage() {
  const { user, profile, activeMode, roles: cachedRoles, loading: authLoading } = useAuth();

  const freshRoles = useQuery({
    queryKey: ["account-authoritative-roles", user?.id],
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);

      if (error) throw error;
      return (data ?? []).map((row) => String(row.role));
    },
  });

  if (!user || authLoading || freshRoles.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (freshRoles.isError) {
    return (
      <div className="surface-card p-5 text-sm text-destructive">
        Could not verify your account role. Please refresh and try again.
      </div>
    );
  }

  const roles = Array.from(new Set([...(cachedRoles ?? []), ...(freshRoles.data ?? [])]));
  const isAdmin = roles.includes("admin");
  const hasDriverRole = roles.includes("driver");
  const hasCustomerRole = roles.includes("customer");

  // active_mode decides between Customer and Driver only when both roles exist.
  // If the account has only the driver role, it is always a Driver interface.
  // Admin is handled separately and never falls through to Customer/Driver.
  const effectiveActiveMode = profile?.active_mode ?? activeMode;
  const isDriver = !isAdmin && hasDriverRole && (effectiveActiveMode === "driver" || !hasCustomerRole);
  const isCustomer = !isAdmin && !isDriver && hasCustomerRole;

  if (isAdmin) {
    return (
      <div className="space-y-5">
        <AdminAccountProfile />
      </div>
    );
  }

  if (isDriver) {
    return <DriverProfileView />;
  }

  if (isCustomer) {
    return <CustomerProfileView />;
  }

  return (
    <div className="surface-card p-5 text-sm text-muted-foreground">
      Your account role is not available yet. Please sign out and sign in again.
    </div>
  );
}
