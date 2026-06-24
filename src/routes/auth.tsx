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
    if (loading || !user || !role) return;
    if (role === "admin") navigate({ to: "/admin" });
    else if (role === "driver") navigate({ to: "/driver" });
    else navigate({ to: "/customer" });
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
            <TabsContent value="signin" className="pt-5">
              <SignInForm />
            </TabsContent>
            <TabsContent value="signup" className="pt-5">
              <SignUpForm defaultRole={search.as ?? "customer"} />
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
