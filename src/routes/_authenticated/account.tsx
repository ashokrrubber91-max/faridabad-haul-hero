import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  FileText,
  Home,
  Loader2,
  LogOut,
  MapPin,
  Plus,
  ReceiptText,
  Trash2,
  Truck,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SupportChat } from "@/components/support/SupportChat";
import { buildInvoiceHtml, openInvoice } from "@/lib/invoice";
import { vehicleLabel } from "@/lib/booking";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "My account — MiniPort" },
      { name: "description", content: "Manage your MiniPort profile, saved addresses, GST numbers and monthly invoices." },
      { property: "og:title", content: "My account — MiniPort" },
      { property: "og:description", content: "Profile, saved addresses, GSTIN management and bulk invoice downloads." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user, profile, roles } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [gstOpen, setGstOpen] = useState(false);
  const [gstin, setGstin] = useState("");
  const [bizName, setBizName] = useState("");
  const [bizAddr, setBizAddr] = useState("");

  const addresses = useQuery({
    queryKey: ["saved-addresses", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_addresses")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const gstins = useQuery({
    queryKey: ["gstins", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_gstins")
        .select("*")
        .eq("user_id", user!.id)
        .order("is_default", { ascending: false });
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
      qc.invalidateQueries({ queryKey: ["gstins", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefaultGstin = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("customer_gstins").update({ is_default: false }).eq("user_id", user!.id);
      const { error } = await supabase.from("customer_gstins").update({ is_default: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gstins", user?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeGstin = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customer_gstins").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("GSTIN removed");
      qc.invalidateQueries({ queryKey: ["gstins", user?.id] });
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
      qc.invalidateQueries({ queryKey: ["saved-addresses", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadMonthly = async () => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("customer_id", user!.id)
      .eq("status", "completed")
      .gte("created_at", start.toISOString())
      .order("created_at");
    if (error) return toast.error(error.message);
    if (!data || data.length === 0) return toast.info("No completed trips this month yet");
    const defaultGst = (gstins.data ?? []).find((g) => g.is_default);
    const html = data
      .map((b) =>
        buildInvoiceHtml(
          b,
          {
            name: profile?.name ?? "Customer",
            phone: profile?.phone ?? "",
            gstin: defaultGst?.gstin ?? null,
            businessName: defaultGst?.business_name ?? null,
            businessAddress: defaultGst?.business_address ?? null,
          },
          vehicleLabel(b.vehicle_type),
        ),
      )
      .join('<div style="page-break-after:always"></div>');
    if (!openInvoice(html)) toast.error("Allow pop-ups to download invoices");
  };

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-secondary">Account</h1>
        <p className="text-sm text-muted-foreground">Profile, addresses, GST and invoices.</p>
      </header>

      <section className="surface-card p-5">
        <div className="flex items-center gap-3">
          <div className="brand-gradient grid h-12 w-12 place-items-center rounded-full">
            <UserIcon className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-xl tracking-wide text-secondary">{profile?.name ?? "MiniPort user"}</p>
            <p className="text-sm text-muted-foreground">{profile?.phone}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="acc-name">Display name</Label>
            <Input
              id="acc-name"
              value={name || (profile?.name ?? "")}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>
          <Button
            onClick={() => saveName.mutate((name || profile?.name || "").trim())}
            disabled={saveName.isPending || !(name || "").trim()}
          >
            Save
          </Button>
        </div>
      </section>

      <section className="surface-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
            <ReceiptText className="h-4 w-4 text-primary" /> GST numbers
          </h2>
          <Dialog open={gstOpen} onOpenChange={setGstOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a GSTIN</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="g-num">GSTIN</Label>
                  <Input
                    id="g-num"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    maxLength={15}
                    placeholder="06ABCDE1234F1Z5"
                  />
                </div>
                <div>
                  <Label htmlFor="g-biz">Business name</Label>
                  <Input id="g-biz" value={bizName} onChange={(e) => setBizName(e.target.value)} maxLength={80} />
                </div>
                <div>
                  <Label htmlFor="g-addr">Business address (optional)</Label>
                  <Input id="g-addr" value={bizAddr} onChange={(e) => setBizAddr(e.target.value)} maxLength={160} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => addGstin.mutate()} disabled={addGstin.isPending}>
                  {addGstin.isPending ? "Saving…" : "Save GSTIN"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {gstins.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (gstins.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No GSTIN saved. Add one to get GST tax invoices for business bookings.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {(gstins.data ?? []).map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-2.5">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-secondary">{g.business_name}</p>
                  <p className="text-xs text-muted-foreground">{g.gstin}</p>
                </div>
                {g.is_default ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Default
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setDefaultGstin.mutate(g.id)}>
                    Set default
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => removeGstin.mutate(g.id)} aria-label="Remove GSTIN">
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
          <MapPin className="h-4 w-4 text-primary" /> Saved addresses
        </h2>
        {addresses.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (addresses.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved addresses. Tap “Save address” while booking to store one.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {(addresses.data ?? []).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <Home className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-secondary">{a.alias || a.kind}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.address}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => removeAddress.mutate(a.id)} aria-label="Remove address">
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface-card space-y-2 p-5">
        <h2 className="font-display text-xl tracking-wide text-secondary">More</h2>
        <Button variant="outline" className="w-full justify-start" onClick={downloadMonthly}>
          <FileText className="h-4 w-4" /> Download this month&rsquo;s invoices
        </Button>
        {!roles.includes("driver") && (
          <Button variant="outline" className="w-full justify-start" asChild>
            <Link to="/driver-kyc">
              <Truck className="h-4 w-4" /> Become a MiniPort driver
            </Link>
          </Button>
        )}
        <Button variant="ghost" className="w-full justify-start text-destructive" onClick={signOut}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </section>

      <SupportChat role="customer" />
    </div>
  );
}
