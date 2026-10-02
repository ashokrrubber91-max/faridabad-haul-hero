import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";
import { useAuth } from "@/hooks/useAuth";
import { getAdminSetupState, claimFirstAdmin } from "@/lib/admin.functions";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const AdminConsole = lazy(() => import("@/components/admin/AdminConsole").then((m) => ({ default: m.AdminConsole })));

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — MiniPort" }] }),
  component: AdminGate,
  errorComponent: RouteErrorFallback,
});

function AdminGate() {
  const { loading, user, roles } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/admin/login", replace: true });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="mx-auto mt-24 w-full max-w-xl space-y-3 px-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-24 w-full" /></div>
    );
  }

  if (!roles.includes("admin")) return <AdminSetupOrDenied />;
  return <ErrorBoundary label="admin console"><Suspense fallback={<div className="mx-auto mt-12 max-w-5xl px-4"><Skeleton className="h-8 w-48" /><Skeleton className="mt-4 h-64 w-full" /></div>}><AdminConsole /></Suspense></ErrorBoundary>;
}

function AdminSetupOrDenied() {
  const setupState = useServerFn(getAdminSetupState);
  const claim = useServerFn(claimFirstAdmin);
  const [busy, setBusy] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-setup-state"],
    queryFn: () => setupState({}),
  });

  if (isLoading) {
    return <div className="mt-24 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  if (isError) {
    return (
      <div className="mx-auto mt-24 max-w-sm rounded-lg border bg-card p-6 text-center shadow-sm">
        <Ban className="mx-auto mb-2 h-6 w-6 text-destructive" />
        <h1 className="font-display text-2xl tracking-wide text-secondary">Could not check access</h1>
        <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button variant="outline" className="mt-4 w-full" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }

  if (data && !data.adminExists) {
    return (
      <div className="mx-auto mt-24 max-w-sm rounded-lg border bg-card p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-primary" />
        <h1 className="font-display text-2xl tracking-wide text-secondary">Set up your team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          No team account exists yet. Claim this signed-in account as the first MiniPort admin.
        </p>
        <Button
          className="mt-4 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await claim({});
              toast.success("You are now the MiniPort admin");
              window.location.reload();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Setup failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Setting up…" : "Make me the first admin"}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-24 max-w-sm rounded-lg border bg-card p-6 text-center shadow-sm">
      <Ban className="mx-auto mb-2 h-6 w-6 text-destructive" />
      <h1 className="font-display text-2xl tracking-wide text-secondary">Not authorised</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This area is limited to MiniPort team accounts. Ask an existing admin to grant you access.
      </p>
      <Button asChild variant="outline" className="mt-4 w-full"><Link to="/">Back to home</Link></Button>
    </div>
  );
}
