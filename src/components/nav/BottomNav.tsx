import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Package, Wallet, User, Truck, ClipboardList } from "lucide-react";

type Tab = { to: string; label: string; icon: typeof Home };

const CUSTOMER_TABS: Tab[] = [
  { to: "/customer", label: "Home", icon: Home },
  { to: "/orders", label: "Orders", icon: Package },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/account", label: "Account", icon: User },
];

const DRIVER_TABS: Tab[] = [
  { to: "/driver", label: "Home", icon: Truck },
  { to: "/driver-rides", label: "My Rides", icon: ClipboardList },
  { to: "/wallet", label: "Earnings", icon: Wallet },
  { to: "/driver-profile", label: "Profile", icon: User },
];

export function BottomNav({ variant }: { variant: "customer" | "driver" }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabs = variant === "customer" ? CUSTOMER_TABS : DRIVER_TABS;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-5xl">
        {tabs.map((t) => {
          const active = pathname === t.to;
          const Icon = t.icon;
          return (
            <li key={t.to} className="flex-1">
              <Link
                to={t.to}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-secondary"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
