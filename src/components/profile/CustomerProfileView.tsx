import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, Gift, Home, Loader2, LogOut, MapPin, Plus, ReceiptText, Trash2, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NotificationsCard } from "@/components/NotificationsCard";
import { BecomeDriverCard } from "@/components/driver/BecomeDriverCard";
import { DeleteAccountCard } from "@/components/account/DeleteAccountCard";
import { MerchantAccountCard } from "@/components/account/MerchantAccountCard";
import { SupportChat } from "@/components/support/SupportChat";
import { signOutEverywhere } from "@/lib/session";

export function CustomerProfileView() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [gstOpen, setGstOpen] = useState(false);
  const [gstin, setGstin] = useState("");
  const [bizName, setBizName] = useState("");
  const [bizAddr, setBizAddr] = useState("");

  const addresses = useQuery({
    queryKey: ["customer-profile-saved-addresses", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("saved_addresses").select("*").eq("user_id", user!.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const gstins = useQuery({
    queryKey: ["customer-profile-gstins", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_gstins").select("*").eq("user_id", user!.id).order("is_default", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveName = useMutation({
    mutationFn: async (next: string) => {
      const { error } = await supabase.from("profiles").update({ name: next }).eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => toast.success("Profile updated"),
    onError: (e: Error) => toast.error(e.message),
  });

  const addGstin = useMutation({
    mutationFn: async () => {
      const code = gstin.trim().toUpperCase();
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(code)) throw new Error("Enter a valid 15-character GSTIN");
      if (bizName.trim().length < 2) throw new Error("Enter the business name");
      const { error } = await supabase.from("customer_gstins").insert({
        user_id: user!.id,
        gstin: code,
        business_name: bizName.trim(),
        business_address: bizAddr.trim() || null,
        is_default: (gstins.data ?? []).length === 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("GSTIN saved");
      setGstOpen(false);
      setGstin("");
      setBizName("");
      setBizAddr("");
      qc.invalidateQueries({ queryKey: ["customer-profile-gstins", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefaultGstin = useMutation({
    mutationFn: async (id: string) => {
      const { error: clearError } = await supabase.from("customer_gstins").update({ is_default: false }).eq("user_id", user!.id);
      if (clearError) throw clearError;
      const { error } = await supabase.from("customer_gstins").update({ is_default: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-profile-gstins", user?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeGstin = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customer_gstins").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("GSTIN removed");
      qc.invalidateQueries({ queryKey: ["customer-profile-gstins", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeAddress = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("saved_addresses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Address removed");
      qc.invalidateQueries({ queryKey: ["customer-profile-saved-addresses", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!user) return null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-secondary">Customer account</h1>
        <p className="text-sm text-muted-foreground">Profile, addresses, GST and customer settings.</p>
      </header>

      <section className="surface-card p-5">
        <div className="flex items-center gap-3">
          <div className="brand-gradient grid h-12 w-12 place-items-center rounded-full"><UserIcon className="h-6 w-6 text-white" /></div>
          <div className="min-w-0">
            <p className="truncate font-display text-xl tracking-wide text-secondary">{profile?.name ?? "MiniPort user"}</p>
            <p className="text-sm text-muted-foreground">{profile?.phone}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="customer-name">Display name</Label>
            <Input id="customer-name" value={name || (profile?.name ?? "")} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <Button onClick={() => saveName.mutate((name || profile?.name || "").trim())} disabled={saveName.isPending || !(name || "").trim()}>Save</Button>
          <Button variant="outline" asChild><Link to="/refer"><Gift className="h-4 w-4" /> Refer & Earn</Link></Button>
        </div>
      </section>

      <NotificationsCard />
      <MerchantAccountCard userId={user.id} />

      <section className="surface-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary"><ReceiptText className="h-4 w-4 text-primary" /> GST numbers</h2>
          <Dialog open={gstOpen} onOpenChange={setGstOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> Add</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add a GSTIN</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label htmlFor="g-num">GSTIN</Label><Input id="g-num" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="06ABCDE1234F1Z5" /></div>
                <div><Label htmlFor="g-biz">Business name</Label><Input id="g-biz" value={bizName} onChange={(e) => setBizName(e.target.value)} maxLength={80} /></div>
                <div><Label htmlFor="g-addr">Business address (optional)</Label><Input id="g-addr" value={bizAddr} onChange={(e) => setBizAddr(e.target.value)} maxLength={160} /></div>
              </div>
              <DialogFooter><Button onClick={() => addGstin.mutate()} disabled={addGstin.isPending}>{addGstin.isPending ? "Saving…" : "Save GSTIN"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {gstins.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : (gstins.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No GSTIN saved. Add one to get GST tax invoices for business bookings.</p>
        ) : (
          <ul className="divide-y divide-border">
            {(gstins.data ?? []).map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-2.5">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-secondary">{g.business_name}</p><p className="text-xs text-muted-foreground">{g.gstin}</p></div>
                {g.is_default ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Default</span> : <Button size="sm" variant="ghost" onClick={() => setDefaultGstin.mutate(g.id)}>Set default</Button>}
                <Button size="sm" variant="ghost" onClick={() => removeGstin.mutate(g.id)} aria-label="Remove GSTIN"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl tracking-wide text-secondary"><MapPin className="h-4 w-4 text-primary" /> Saved addresses</h2>
        {addresses.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : (addresses.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved addresses. Tap “Save address” while booking to store one.</p>
        ) : (
          <ul className="divide-y divide-border">
            {(addresses.data ?? []).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <Home className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-secondary">{a.alias || a.kind}</p><p className="truncate text-xs text-muted-foreground">{a.address}</p></div>
                <Button size="sm" variant="ghost" onClick={() => removeAddress.mutate(a.id)} aria-label="Remove address"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BecomeDriverCard userId={user.id} />

      <section className="surface-card space-y-2 p-5">
        <h2 className="font-display text-xl tracking-wide text-secondary">More</h2>
        <a className="flex w-full items-center justify-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted" href="/privacy.html">Privacy policy</a>
        <a className="flex w-full items-center justify-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted" href="/terms.html">Terms of service</a>
        <DeleteAccountCard />
        <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => void signOutEverywhere(qc)}><LogOut className="h-4 w-4" /> Sign out</Button>
      </section>

      <SupportChat role="customer" />
    </div>
  );
}
