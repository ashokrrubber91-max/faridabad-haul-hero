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
  // Two-step verification: enroll an authenticator app once, then enter its code every sign-in.
  const [stage, setStage] = useState<"password" | "mfa">("password");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const beginTwoStep = async () => {
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level?.currentLevel === "aal2") {
      navigate({ to: "/admin", replace: true });
      return;
    }
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      toast.error("Could not start two-step verification. Try again.");
      return;
    }
    const verified = factors?.totp?.find((f) => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setQrCode(null);
      setSecret(null);
      setStage("mfa");
      return;
    }
    // Drop any half-finished enrollment, then start a fresh one.
    for (const f of factors?.all ?? []) {
      if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "MiniPort Admin",
    });
    if (error || !data) {
      toast.error(error?.message ?? "Could not set up two-step verification.");
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setStage("mfa");
  };

  const verifyTwoStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || code.replace(/\D/g, "").length !== 6) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.replace(/\D/g, ""),
    });
    setBusy(false);
    if (error) {
      toast.error("That code was not accepted. Wait for the next code and try again.");
      setCode("");
      return;
    }
    navigate({ to: "/admin", replace: true });
  };

  // A team account that is already signed in continues with the second step.
  useEffect(() => {
    if (loading || !user || stage !== "password") return;
    if (roles.includes("admin")) void beginTwoStep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, roles]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Enter the 10-digit phone number of your team account");
      return;
    }
    setBusy(true);
    setDenied(false);
    let error: Error | null = null;
    try {
      const result = await Promise.race([
        supabase.auth.signInWithPassword({
          email: phoneToEmail(phone),
          password,
        }),
        new Promise<{ data: { user: null; session: null }; error: Error }>((resolve) =>
          setTimeout(
            () =>
              resolve({ data: { user: null, session: null }, error: new Error("AUTH_TIMEOUT") }),
            15000,
          ),
        ),
      ]);
      error = result.error;
    } catch {
      error = new Error("AUTH_REQUEST_FAILED");
    }
    if (error) {
      setBusy(false);
      toast.error(
        error.message === "AUTH_TIMEOUT"
          ? "Sign-in timed out. Check your connection and try again."
          : error.message === "AUTH_REQUEST_FAILED"
            ? "Could not sign in right now. Please check your connection and try again."
            : error.message,
      );
      return;
    }
    // The role is confirmed by the server, never by anything the browser holds.
    try {
      const state = await checkAccess({});
      setBusy(false);
      if (state.isAdmin) {
        await beginTwoStep();
        return;
      }
      if (!state.adminExists) {
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

          {stage === "mfa" ? (
            <form onSubmit={verifyTwoStep} className="mt-5 space-y-4">
              {qrCode ? (
                <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
                  <p className="font-semibold text-secondary">Set up two-step verification</p>
                  <p className="mt-1 text-muted-foreground">
                    Scan this code with Google Authenticator, Authy or a similar app, then enter the
                    6-digit code it shows.
                  </p>
                  <img
                    src={qrCode}
                    alt="Authenticator setup QR code"
                    className="mx-auto mt-3 h-44 w-44 rounded bg-white p-2"
                  />
                  {secret ? (
                    <p className="mt-2 break-all text-center text-xs text-muted-foreground">
                      Can&rsquo;t scan? Enter this key: <span className="font-mono">{secret}</span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code from your authenticator app.
                </p>
              )}
              <div>
                <Label htmlFor="admin-code">6-digit code</Label>
                <Input
                  id="admin-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>
              <Button type="submit" className="h-11 w-full text-base" loading={busy}>
                Verify and open control room
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline"
                onClick={async () => {
                  await supabase.auth.signOut();
                  setStage("password");
                  setCode("");
                  setPassword("");
                }}
              >
                Use a different account
              </button>
            </form>
          ) : null}

          <form onSubmit={submit} className={stage === "mfa" ? "hidden" : "mt-5 space-y-4"}>
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
