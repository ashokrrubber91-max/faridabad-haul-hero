import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { phoneToEmail, useAuth } from "@/hooks/useAuth";
import { getAdminSetupState } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin_/login")({
  head: () => ({
    meta: [
      { title: "Team sign-in — MiniPort Admin" },
      {
        name: "description",
        content: "Secure sign-in for the MiniPort operations team control room.",
      },
      { property: "og:title", content: "Team sign-in — MiniPort Admin" },
      {
        property: "og:description",
        content: "Secure sign-in for the MiniPort operations team control room.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const { user, roles, loading } = useAuth();
  const checkAccess = useServerFn(getAdminSetupState);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  // An account that already holds the team role goes straight to the control room.
  useEffect(() => {
    if (loading || !user) return;
    if (roles.includes("admin")) navigate({ to: "/admin", replace: true });
  }, [loading, user, roles, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Enter the 10-digit phone number of your team account");
      return;
    }
    setBusy(true);
    setDenied(false);
    const { error } = await supabase.auth.signInWithPassword({
      email: phoneToEmail(phone),
      password,
    });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    // The role is confirmed by the server, never by anything the browser holds.
    try {
      const state = await checkAccess({});
      setBusy(false);
      if (state.isAdmin || !state.adminExists) {
        navigate({ to: "/admin", replace: true });
        return;
      }
      setDenied(true);
    } catch {
      setBusy(false);
      toast.error("Could not confirm your access. Try again.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <div className="inline-flex items-center gap-2">
          <div className="brand-gradient grid h-9 w-9 place-items-center rounded-lg shadow-sm">
            <Truck className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display text-xl tracking-wide text-secondary sm:text-2xl">
            MINIPORT
          </span>
        </div>
        <Link to="/" className="text-xs text-muted-foreground underline sm:text-sm">
          Back to MiniPort
        </Link>
      </header>

      <main className="mx-auto w-full max-w-md px-5 pb-12 pt-4">
        <div className="surface-card p-6">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="mt-2 font-display text-2xl tracking-wide text-secondary sm:text-3xl">
            Admin / Team sign in
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            For MiniPort operations staff only. Customers and drivers should use the normal sign-in
            page.
          </p>

          {denied ? (
            <div className="mt-5 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="font-semibold text-secondary">Access denied</p>
              <p className="mt-1 text-muted-foreground">
                You are signed in, but this account is not a MiniPort team account. Ask an existing
                admin to grant you access.
              </p>
            </div>
          ) : null}

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label htmlFor="admin-phone">Phone number</Label>
              <Input
                id="admin-phone"
                inputMode="tel"
                autoComplete="tel"
                placeholder="98xxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="admin-pw">Password</Label>
              <Input
                id="admin-pw"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…
                </>
              ) : (
                "Sign in to control room"
              )}
            </Button>
          </form>

          {user && !denied ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Signed in already?{" "}
              <Link to="/admin" className="underline">
                Open the control room
              </Link>
            </p>
          ) : null}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Not team staff?{" "}
          <Link to="/auth" search={{ mode: "signin" }} className="underline">
            Customer &amp; driver sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
