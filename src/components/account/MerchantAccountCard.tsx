import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function MerchantAccountCard({ userId }: { userId?: string }) {
  const qc=useQueryClient();
  const [businessName,setBusinessName]=useState("");
  const [gstin,setGstin]=useState("");
  const [address,setAddress]=useState("");
  const [postpaid,setPostpaid]=useState(false);
  const q=useQuery({
    queryKey:["merchant-account",userId],
    enabled:!!userId,
    queryFn:async()=>{const {data,error}=await supabase.from("merchant_accounts").select("*").eq("user_id",userId!).maybeSingle();if(error)throw error;if(data){setBusinessName(data.business_name);setGstin(data.gstin??"");setAddress(data.business_address??"");setPostpaid(data.postpaid_enabled);}return data;}
  });
  const save=useMutation({
    mutationFn:async()=>{if(businessName.trim().length<2)throw new Error("Enter business name");const payload={user_id:userId!,business_name:businessName.trim(),gstin:gstin.trim()||null,business_address:address.trim()||null,postpaid_enabled:postpaid};const {error}=await supabase.from("merchant_accounts").upsert(payload,{onConflict:"user_id"});if(error)throw error;},
    onSuccess:()=>{toast.success("Business account saved");qc.invalidateQueries({queryKey:["merchant-account",userId]});},
    onError:(e:Error)=>toast.error(e.message)
  });
  return <section className="surface-card p-5">
    <div className="flex items-start gap-3">
      <Building2 className="mt-0.5 h-5 w-5 text-primary"/>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-xl tracking-wide text-secondary">Business Account</h2>
        <p className="text-xs text-muted-foreground">For verified industrial merchants: GST billing, monthly consolidated statements and postpaid credit.</p>
      </div>
    </div>
    {q.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p> :
    <div className="mt-4 space-y-3">
      <div><Label>Business name</Label><Input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="ABC Industries"/></div>
      <div><Label>GSTIN (optional)</Label><Input value={gstin} onChange={e=>setGstin(e.target.value.toUpperCase())} maxLength={15}/></div>
      <div><Label>Business address</Label><Input value={address} onChange={e=>setAddress(e.target.value)} /></div>
      <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={postpaid} onChange={e=>setPostpaid(e.target.checked)}/><span><b>Monthly consolidated billing</b><br/><span className="text-xs text-muted-foreground">Postpaid is activated only after MiniPort verifies the business account.</span></span></label>
      {q.data && <p className="text-xs text-muted-foreground">Status: {q.data.verified ? "Verified" : "Verification pending"} · Credit limit: ₹{Number(q.data.credit_limit||0).toFixed(0)}</p>}
      <Button onClick={()=>save.mutate()} disabled={save.isPending}>{save.isPending?"Saving…":"Save business account"}</Button>
    </div>}
  </section>
}
