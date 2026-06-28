import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Truck, LogOut, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { role, roles, profile, activeMode, setActiveMode } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const isDualRole = roles.includes("driver") && role !== "admin";

  const toggleMode = async () => {
    const next = activeMode === "customer" ? "driver" : "customer";
    try {
      await setActiveMode(next);
      toast.success(next === "driver" ? "Switched to Driver mode" : "Switched to Customer mode");
      navigate({ to: next === "driver" ? "/driver" : "/customer", replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Tab visibility: admin sees everything; dual-role users see only the active mode's tab.
  const tabs: Array<{ to: "/customer" | "/driver" | "/admin"; label: string; show: boolean }> = [
    {
      to: "/customer",
      label: "Book",
      show: role === "admin" || (role === "customer" && !isDualRole) || (isDualRole && activeMode === "customer"),
    },
    {
      to: "/driver",
      label: "Drive",
      show: role === "admin" || (role === "driver" && !isDualRole) || (isDualRole && activeMode === "driver"),
    },
    { to: "/admin", label: "Admin", show: role === "admin" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="brand-gradient grid h-8 w-8 place-items-center rounded-md">
              <Truck className="h-4 w-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-display text-xl tracking-wide text-secondary">MINIPORT</span>
          </Link>
          <div className="flex items-center gap-2">
            {isDualRole && (
              <Button
                size="sm"
                variant="outline"
                onClick={toggleMode}
                className="gap-1.5"
                aria-label={`Switch to ${activeMode === "customer" ? "driver" : "customer"} mode`}
              >
                <UserRound className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">
                  {activeMode === "customer" ? "Drive" : "Book"}
                </span>
              </Button>
            )}
            {profile?.name && (
              <div className="text-right">
                <p className="text-xs font-semibold text-secondary sm:text-sm">
                  Welcome, {profile.name.split(" ")[0]}
                </p>
                <p className="hidden text-xs text-muted-foreground sm:block">{profile.phone}</p>
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {tabs.filter((t) => t.show).length > 1 && (
          <nav className="mx-auto flex max-w-5xl gap-1 px-4 pb-2">
            {tabs.filter((t) => t.show).map((t) => {
              const active = pathname.startsWith(t.to);
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
