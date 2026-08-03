import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { phoneToEmail, useAuth } from "@/hooks/useAuth";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
  as: z.enum(["customer", "driver"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in \u2014 MiniPort" },
      { name: "description", content: "Sign in or create your MiniPort account to book a mini truck or accept rides." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const search = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const { user, role, loading } = useAuth();
  const [tab, setTab] = useState<"signin" | "signup">(search.mode ?? "signin");

  useEffect(() => {
    if (loading || !user) return;
    if (role === "admin") navigate({ to: "/admin", replace: true });
    else if (role === "driver") navigate({ to: "/driver", replace: true });
    else navigate({ to: "/customer", replace: true });
  }, [user, role, loading, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="px-5 py-4 sm:px-8">
        <Link to="/" className="inline-flex items-center gap-2">
          <div className="brand-gradient grid h-9 w-9 place-items-center rounded-lg shadow-sm">
            <Truck className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display text-2xl tracking-wide text-secondary">MINIPORT</span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-md px-5 pb-12 pt-4">
        <div className="surface-card p-6">
          <h1 className="font-display text-3xl tracking-wide text-secondary">Welcome</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your phone number and a password to continue.</p>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")} className="mt-5">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="pt-5 space-y-5">
              <SignInForm />
              <OrDivider />
              <SocialAuthButtons />
            </TabsContent>
            <TabsContent value="signup" className="pt-5 space-y-5">
              <SignUpForm defaultRole={search.as ?? "customer"} />
              <OrDivider />
              <SocialAuthButtons />
            </TabsContent>
          </Tabs>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Real OTP sign-in can be enabled later by connecting an SMS provider.
        </p>
      </main>
    </div>
  );
}

function SignInForm() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Enter a 10-digit phone number");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: phoneToEmail(phone),
      password,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Signed in");
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="signin-phone">Phone number</Label>
        <Input id="signin-phone" inputMode="tel" autoComplete="tel" placeholder="98xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="signin-pw">Password</Label>
        <Input id="signin-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
      </div>
      <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
        {busy ? "Signing in\u2026" : "Sign in"}
      </Button>
    </form>
  );
}

function SignUpForm({ defaultRole }: { defaultRole: "customer" | "driver" }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"customer" | "driver">(defaultRole);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) return toast.error("Enter a 10-digit phone number");
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    if (name.trim().length < 2) return toast.error("Enter your name");

    setBusy(true);
    const email = phoneToEmail(phone);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { phone: phone.replace(/\D/g, ""), name: name.trim(), role },
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    // If email confirmation is off (default for Lovable Cloud), session is active.
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInErr) {
      toast.success("Account created \u2014 you can sign in now");
    } else {
      toast.success("Welcome to MiniPort!");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label>I want to</Label>
        <RadioGroup value={role} onValueChange={(v) => setRole(v as "customer" | "driver")} className="mt-2 grid grid-cols-2 gap-2">
          <label htmlFor="r-cust" className={`cursor-pointer rounded-md border p-3 text-sm ${role === "customer" ? "border-primary bg-accent" : "border-border"}`}>
            <RadioGroupItem id="r-cust" value="customer" className="sr-only" />
            <p className="font-semibold text-secondary">Book trucks</p>
            <p className="text-xs text-muted-foreground">I&rsquo;m a customer</p>
          </label>
          <label htmlFor="r-drv" className={`cursor-pointer rounded-md border p-3 text-sm ${role === "driver" ? "border-primary bg-accent" : "border-border"}`}>
            <RadioGroupItem id="r-drv" value="driver" className="sr-only" />
            <p className="font-semibold text-secondary">Drive & earn</p>
            <p className="text-xs text-muted-foreground">I&rsquo;m a driver</p>
          </label>
        </RadioGroup>
      </div>
      <div>
        <Label htmlFor="su-name">Full name</Label>
        <Input id="su-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      </div>
      <div>
        <Label htmlFor="su-phone">Phone number</Label>
        <Input id="su-phone" inputMode="tel" autoComplete="tel" placeholder="98xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="su-pw">Password</Label>
        <Input id="su-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
      </div>
      <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
        {busy ? "Creating\u2026" : "Create account"}
      </Button>
    </form>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function SocialAuthButtons() {
  const [busy, setBusy] = useState<"google" | "apple" | null>(null);

  const signInWith = async (provider: "google" | "apple") => {
    setBusy(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin });
      if (result.error) {
        toast.error(result.error.message ?? "Sign-in failed");
        return;
      }
      if (result.redirected) return;
      // session set -> existing useAuth redirect effect takes over
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full gap-2 text-base"
        disabled={busy !== null}
        onClick={() => signInWith("google")}
      >
        <GoogleGlyph />
        {busy === "google" ? "Connecting\u2026" : "Continue with Google"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full gap-2 text-base"
        disabled={busy !== null}
        onClick={() => signInWith("apple")}
      >
        <AppleGlyph />
        {busy === "apple" ? "Connecting\u2026" : "Continue with Apple"}
      </Button>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.54-5.17 3.54-8.65z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.11 0-5.75-2.1-6.69-4.93H1.3v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.31 14.31c-.24-.72-.38-1.49-.38-2.31s.14-1.59.38-2.31V6.6H1.3A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.3 5.4l4.01-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.3 6.6l4.01 3.09c.94-2.83 3.58-4.94 6.69-4.94z" />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-foreground" aria-hidden="true">
      <path d="M16.36 1.02c.1 1.06-.31 2.1-.94 2.86-.66.78-1.75 1.4-2.79 1.32-.13-1.03.37-2.1 1-2.8.7-.8 1.86-1.38 2.73-1.38zM20.7 17.32c-.44 1.02-.66 1.47-1.23 2.37-.8 1.26-1.93 2.83-3.33 2.84-1.24.02-1.56-.81-3.24-.8-1.68.01-2.03.82-3.27.8-1.4-.02-2.47-1.43-3.27-2.69-2.24-3.5-2.48-7.6-1.1-9.79.98-1.56 2.53-2.47 3.98-2.47 1.48 0 2.41.82 3.64.82 1.19 0 1.91-.82 3.64-.82 1.29 0 2.66.7 3.63 1.91-3.2 1.75-2.68 6.31.55 7.83z" />
    </svg>
  );
}
