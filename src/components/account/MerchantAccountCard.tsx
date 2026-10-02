import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, CircleAlert, Download, FileText, ReceiptText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type BillingCycle = {
  id: string;
  period_start: string;
  period_end: string;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
  invoice_url: string | null;
};

export function MerchantAccountCard({ userId }: { userId?: string }) {
  const qc = useQueryClient();
  const [businessName, setBusinessName] = useState("");
  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [postpaid, setPostpaid] = useState(false);

  const account = useQuery({
    queryKey: ["merchant-account", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("merchant_accounts").select("*").eq("user_id", userId!).maybeSingle();
      if (error) throw error;
      if (data) {
        setBusinessName(data.business_name);
        setGstin(data.gstin ?? "");
        setAddress(data.business_address ?? "");
        setPostpaid(data.postpaid_enabled);
      }
      return data;
    },
  });

  const khata = useQuery({
    queryKey: ["merchant-khata", account.data?.id],
    enabled: !!account.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("merchant_billing_cycles")
        .select("id,period_start,period_end,subtotal,tax,total,status,invoice_url")
        .eq("merchant_id", account.data!.id)
        .order("period_start", { ascending: false }).limit(12);
      if (error) throw error;
      return (data ?? []) as BillingCycle[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (businessName.trim().length < 2) throw new Error("Enter business name");
      const { error } = await supabase.from("merchant_accounts").upsert({
        user_id: userId!, business_name: businessName.trim(), gstin: gstin.trim() || null,
        business_address: address.trim() || null, postpaid_enabled: postpaid,
      }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Business account saved");
      qc.invalidateQueries({ queryKey: ["merchant-account", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cycles = khata.data ?? [];
  const accumulated = cycles.reduce((sum, cycle) => sum + Number(cycle.total || 0), 0);
  const outstanding = cycles.filter((cycle) => cycle.status.toLowerCase() !== "paid")
    .reduce((sum, cycle) => sum + Number(cycle.total || 0), 0);

  return (
    <section className="surface-card p-5">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl tracking-wide text-secondary">Business Account</h2>
          <p className="text-xs text-muted-foreground">GST billing, monthly consolidated statements and postpaid credit for verified industrial merchants.</p>
        </div>
      </div>

      <Tabs defaultValue="account" className="mt-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="account">Business Account</TabsTrigger>
          <TabsTrigger value="khata">Merchant Khata</TabsTrigger>
        </TabsList>
        <TabsContent value="account" className="mt-4">
          {account.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <div className="space-y-3">
              <div><Label>Business name</Label><Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="ABC Industries" /></div>
              <div><Label>GSTIN (optional)</Label><Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} /></div>
              <div><Label>Business address</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
              <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={postpaid} onChange={(e) => setPostpaid(e.target.checked)} />
                <span><b>Monthly consolidated billing</b><br /><span className="text-xs text-muted-foreground">Postpaid is activated only after MiniPort verifies the business account.</span></span>
              </label>
              {account.data && <p className="text-xs text-muted-foreground">Status: {account.data.verified ? "Verified" : "Verification pending"} · Credit limit: ₹{Number(account.data.credit_limit || 0).toFixed(0)}</p>}
              <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save business account"}</Button>
            </div>
          )}
        </TabsContent>
        <TabsContent value="khata" className="mt-4 space-y-4">
          {!account.data ? (
            <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">Save your Business Account first to activate Merchant Khata.</div>
          ) : khata.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading billing history…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Accumulated billing</p>
                  <p className="mt-1 font-display text-2xl text-secondary">₹{accumulated.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">Last 12 billing cycles</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Amount due</p>
                  <p className="mt-1 font-display text-2xl text-destructive">₹{outstanding.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">Unpaid billing cycles</p>
                </div>
              </div>
              {cycles.length === 0 ? (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">No monthly statements are available yet.</div>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  {cycles.map((cycle) => {
                    const paid = cycle.status.toLowerCase() === "paid";
                    return (
                      <div key={cycle.id} className="flex items-center gap-3 border-b p-3 last:border-b-0">
                        <ReceiptText className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-secondary">{new Date(cycle.period_start).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</p>
                          <p className="text-xs text-muted-foreground">{new Date(cycle.period_start).toLocaleDateString("en-IN")} – {new Date(cycle.period_end).toLocaleDateString("en-IN")}{" · "}₹{Number(cycle.total || 0).toFixed(0)}</p>
                        </div>
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${paid ? "text-success" : "text-destructive"}`}>
                          {paid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                          {paid ? "Paid" : "Due"}
                        </span>
                        {cycle.invoice_url ? (
                          <Button size="sm" variant="ghost" asChild>
                            <a href={cycle.invoice_url} target="_blank" rel="noreferrer" aria-label="Download invoice"><Download className="h-4 w-4" /></a>
                          </Button>
                        ) : <FileText className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
