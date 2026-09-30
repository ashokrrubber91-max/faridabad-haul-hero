import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function DriverTopupDialog() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"upi" | "bank_transfer" | "cash">("upi");
  const [reference, setReference] = useState("");

  const requests = useQuery({
    queryKey: ["wallet-topup-requests", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_topup_requests")
        .select("id,amount,method,reference,status,created_at")
        .eq("driver_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!Number.isFinite(value) || value < 100) {
        throw new Error("Minimum top-up request is ₹100");
      }
      if (value > 100000) {
        throw new Error("Maximum top-up request is ₹100,000");
      }

      const { error } = await supabase.from("wallet_topup_requests").insert({
        driver_id: user!.id,
        amount: value,
        method,
        reference: reference.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Add Money request submitted. Your wallet will update after payment verification.");
      setOpen(false);
      setAmount("");
      setReference("");
      setMethod("upi");
      qc.invalidateQueries({ queryKey: ["wallet-topup-requests", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-3 space-y-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full sm:w-auto">
            <Plus className="h-4 w-4" /> Add Money
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Money to wallet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="topup-amount">Amount (₹)</Label>
              <Input
                id="topup-amount"
                inputMode="decimal"
                min={100}
                max={100000}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="100"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Minimum ₹100 · maximum ₹100,000
              </p>
            </div>
            <div>
              <Label>Payment method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="cash">Cash at MiniPort office</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {method !== "cash" && (
              <div>
                <Label htmlFor="topup-reference">Payment reference / UTR (optional)</Label>
                <Input
                  id="topup-reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value.slice(0, 80))}
                  placeholder="Enter UTR / transaction reference"
                  maxLength={80}
                />
              </div>
            )}
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p>
                  This is a secure top-up request. MiniPort does not credit money just from a
                  button click. After the payment is verified by an admin, the approved amount is
                  added to your wallet.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit Add Money request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {requests.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : (
        requests.data?.some((r) => r.status === "pending") && (
          <p className="text-xs text-warning-foreground">
            You have a pending Add Money request. It will be credited after verification.
          </p>
        )
      )}
    </div>
  );
}
