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
  const { role, profile } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const tabs: Array<{ to: "/customer" | "/driver" | "/admin"; label: string; show: boolean }> = [
    { to: "/customer", label: "Book", show: role === "customer" || role === "admin" },
    { to: "/driver", label: "Drive", show: role === "driver" || role === "admin" },
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
