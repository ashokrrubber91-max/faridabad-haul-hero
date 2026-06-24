import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Truck, ShieldCheck, Clock, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MiniPort \u2014 Mini truck booking in Faridabad" },
      { name: "description", content: "Book a Tata Ace, Pickup or Tata 407 anywhere in Faridabad. Live driver assignment, transparent fares." },
    ],
  }),
  component: Index,
});

function Index() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !user || !role) return;
    if (role === "admin") navigate({ to: "/admin" });
    else if (role === "driver") navigate({ to: "/driver" });
    else navigate({ to: "/customer" });
  }, [user, role, loading, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <div className="brand-gradient grid h-9 w-9 place-items-center rounded-lg shadow-sm">
            <Truck className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display text-2xl tracking-wide text-secondary">MINIPORT</span>
        </div>
        <Link to="/auth">
          <Button variant="outline" size="sm">Sign in</Button>
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-16 pt-8 sm:px-8 sm:pt-16">
        <section className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-semibold uppercase tracking-wider text-secondary">
              <MapPin className="h-3.5 w-3.5" /> Faridabad
            </span>
            <h1 className="mt-4 font-display text-5xl leading-[0.95] tracking-wide text-secondary sm:text-7xl">
              Mini trucks,<br />
              <span className="text-primary">on demand.</span>
            </h1>
            <p className="mt-5 max-w-md text-base text-muted-foreground sm:text-lg">
              Book a Tata Ace, 8ft Pickup or Tata 407 anywhere across Faridabad. Drivers accept within minutes, fares are flat-rate and shown upfront.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/auth" search={{ mode: "signup", as: "customer" }}>
                <Button size="lg" className="h-12 px-6 text-base">Book a truck</Button>
              </Link>
              <Link to="/auth" search={{ mode: "signup", as: "driver" }}>
                <Button size="lg" variant="secondary" className="h-12 px-6 text-base">Drive with MiniPort</Button>
              </Link>
            </div>
          </div>

          <div className="surface-card relative p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sector 21 \u2192 NIT</p>
                <p className="font-display text-3xl text-secondary">\u20b9 374</p>
              </div>
              <div className="brand-gradient rounded-lg p-3">
                <Truck className="h-6 w-6 text-white" />
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              {[
                { icon: Clock, t: "Driver in 4 min", s: "Real-time queue" },
                { icon: ShieldCheck, t: "Verified drivers", s: "ID + vehicle checked" },
                { icon: MapPin, t: "All of Faridabad", s: "NIT, Sector 15, Ballabgarh \u2026" },
              ].map((f) => (
                <div key={f.t} className="flex items-start gap-3 rounded-md bg-muted/60 p-3">
                  <f.icon className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <p className="font-semibold text-secondary">{f.t}</p>
                    <p className="text-xs text-muted-foreground">{f.s}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
