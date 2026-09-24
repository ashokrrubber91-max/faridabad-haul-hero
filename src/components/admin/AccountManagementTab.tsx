import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Plus, RefreshCw, Search, Shield, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { adminCreateAccount, adminListAccounts, adminResetPassword, adminUpdateAccountStatus } from "@/lib/admin.functions";

type Account = {
  id: string; name: string; phone: string; email: string; roles: string[];
  active: boolean; createdAt: string; lastSignIn: string | null; lastAction: string | null;
};

function makeTempPassword() {
  return `MP-${Math.random().toString(36).slice(2, 8)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function AccountManagementTab() {
  const list = useServerFn(adminListAccounts);
  const create = useServerFn(adminCreateAccount);
  const updateStatus = useServerFn(adminUpdateAccountStatus);
  const resetPassword = useServerFn(adminResetPassword);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState<Account | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", password: makeTempPassword(), role: "customer" });
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await list({});
      setAccounts(result.accounts as Account[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load accounts");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const createAccount = async () => {
    if (!/^\d{10}$/.test(form.phone)) return toast.error("Enter a valid 10-digit Indian mobile number");
    setBusy(true);
    try {
      await create({ data: form });
      toast.success(`${form.role} account created. Give the temporary password securely to the user.`);
      setOpen(false);
      setForm({ name: "", phone: "", password: makeTempPassword(), role: "customer" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create account");
    } finally { setBusy(false); }
  };

  const toggle = async (account: Account) => {
    setBusy(true);
    try {
      await updateStatus({ data: { userId: account.id, active: !account.active } });
      toast.success(account.active ? "Account suspended" : "Account reactivated");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update account"); }
    finally { setBusy(false); }
  };

  const doReset = async () => {
    if (!resetOpen || resetPasswordValue.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy(true);
    try {
      await resetPassword({ data: { userId: resetOpen.id, password: resetPasswordValue } });
      toast.success("Password reset successfully");
      setResetOpen(null);
      setResetPasswordValue("");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not reset password"); }
    finally { setBusy(false); }
  };

  const filtered = accounts.filter((a) =>
    [a.name, a.phone, a.email, a.roles.join(" ")].join(" ").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <section className="surface-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="font-display text-xl tracking-wide text-secondary">Authentication & Accounts</h3>
            <p className="text-xs text-muted-foreground">Admin-only account creation, access control and password recovery. SMS OTP is not required.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
            <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Create account</Button>
          </div>
        </div>
        <div className="border-b border-border p-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, phone, email or role" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="divide-y divide-border">
          {loading && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading accounts…</p>}
          {!loading && filtered.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No accounts found.</p>}
          {filtered.map((a) => (
            <div key={a.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-secondary">{a.name || "Unnamed account"}</p>
                  {a.roles.map((r) => <Badge key={r} variant={r === "admin" ? "default" : "outline"}>{r}</Badge>)}
                  <Badge className={a.active ? "bg-success text-success-foreground hover:bg-success" : "bg-destructive text-destructive-foreground hover:bg-destructive"}>
                    {a.active ? "Active" : "Suspended"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{a.phone || "—"} · {a.email}</p>
                <p className="text-xs text-muted-foreground">
                  Created {new Date(a.createdAt).toLocaleDateString("en-IN")}
                  {a.lastSignIn ? ` · Last login ${new Date(a.lastSignIn).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}` : " · Never logged in"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => { setResetOpen(a); setResetPasswordValue(makeTempPassword()); }}><KeyRound className="h-3.5 w-3.5" /> Reset password</Button>
                <Button size="sm" variant="outline" disabled={busy || a.roles.includes("admin")} onClick={() => void toggle(a)}>
                  {a.active ? <><UserX className="h-3.5 w-3.5" /> Suspend</> : <><UserCheck className="h-3.5 w-3.5" /> Reactivate</>}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create MiniPort account</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>10-digit mobile</Label><Input inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></div>
            <div><Label>Account type</Label><Select value={form.role} onValueChange={(role) => setForm({ ...form, role })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="customer">Customer</SelectItem><SelectItem value="driver">Driver</SelectItem><SelectItem value="staff">Staff</SelectItem></SelectContent></Select></div>
            <div><Label>Temporary password</Label><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <p className="text-xs text-muted-foreground">No SMS is sent. Give the temporary password to the user through a secure channel. Twilio can be connected later for OTP.</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void createAccount()} disabled={busy}>{busy ? "Creating…" : "Create account"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetOpen} onOpenChange={(o) => !o && setResetOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset password — {resetOpen?.name || resetOpen?.phone}</DialogTitle></DialogHeader>
          <div><Label>New temporary password</Label><Input type="text" value={resetPasswordValue} onChange={(e) => setResetPasswordValue(e.target.value)} /></div>
          <p className="mt-2 text-xs text-muted-foreground">No SMS is sent. Share the new password securely with the account owner.</p>
          <DialogFooter><Button variant="outline" onClick={() => setResetOpen(null)}>Cancel</Button><Button onClick={() => void doReset()} disabled={busy}>Reset password</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
