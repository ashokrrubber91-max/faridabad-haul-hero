import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createInstantDriverPayout } from "@/lib/payouts.functions";
import { toast } from "sonner";

export function InstantPayoutDialog({ cash, userId, onDone }: { cash: number; userId?: string; onDone?: () => void }) {
  const [open,setOpen]=useState(false);
  const [amount,setAmount]=useState("");
  const [upi,setUpi]=useState("");
  const [method,setMethod]=useState<"upi"|"bank">("upi");
  const banks=useQuery({
    queryKey:["instant-payout-banks",userId],
    enabled:open && !!userId,
    queryFn:async()=>{ const {data,error}=await supabase.from("driver_bank_accounts").select("id,account_holder,bank_name,account_number,ifsc,upi_id,is_default").eq("driver_id",userId!).order("is_default",{ascending:false}); if(error) throw error; return data??[]; }
  });
  const [bankId,setBankId]=useState("");
  const payout=useMutation({
    mutationFn:async()=>createInstantDriverPayout({data:{amount:Number(amount),method,upiId:method==="upi"?upi:null,bankAccountId:method==="bank"?bankId:null}}),
    onSuccess:(r)=>{toast.success(`₹${r.amount} payout initiated successfully`);setOpen(false);setAmount("");setUpi("");onDone?.();},
    onError:(e:Error)=>toast.error(e.message)
  });
  const value=Math.floor(Number(amount)||0);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline"><Zap className="h-4 w-4"/> Instant payout</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>Instant driver payout</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Available: ₹{Math.max(0,cash).toFixed(0)}. Payouts use RazorpayX and are sent to your UPI ID or saved bank account.</p>
        <div><Label>Amount</Label><Input type="number" min={100} max={Math.max(100,cash)} value={amount} onChange={e=>setAmount(e.target.value)} placeholder="1000"/></div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={method==="upi"?"default":"outline"} onClick={()=>setMethod("upi")}>UPI</Button>
          <Button type="button" variant={method==="bank"?"default":"outline"} onClick={()=>setMethod("bank")}>Bank</Button>
        </div>
        {method==="upi" ? <div><Label>UPI ID</Label><Input value={upi} onChange={e=>setUpi(e.target.value.trim())} placeholder="name@upi"/></div> :
          <div><Label>Saved bank account</Label><select className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={bankId} onChange={e=>setBankId(e.target.value)}><option value="">Select bank account</option>{(banks.data??[]).map((b:any)=><option key={b.id} value={b.id}>{b.bank_name} · ****{String(b.account_number).slice(-4)}</option>)}</select></div>}
      </div>
      <DialogFooter><Button disabled={payout.isPending || value<100 || value>cash || (method==="upi"?!upi:!bankId)} onClick={()=>payout.mutate()}>Send ₹{value||0}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
