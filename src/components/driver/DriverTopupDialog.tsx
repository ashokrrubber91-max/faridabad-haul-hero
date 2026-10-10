import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { createWalletTopupOrder, confirmWalletTopupPayment, getPaymentConfig } from "@/lib/payments.functions";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";

export function DriverTopupDialog({ customerMode = false }: { customerMode?: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const payOnline = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 100) return void toast.error("Minimum Add Money amount is ₹100");
    if (value > 100000) return void toast.error("Maximum Add Money amount is ₹100,000");
    try {
      const config = await getPaymentConfig();
      if (!config.configured || !config.keyId) throw new Error("Online payments are not configured yet.");
      const order = await createWalletTopupOrder({ data: { amount: value } });
      const result = await openRazorpayCheckout({
        keyId: order.keyId, orderId: order.orderId, amountRupees: order.amount,
        currency: order.currency, customerPhone: user?.phone ?? "",
        description: customerMode ? "MiniPort customer wallet top-up" : "MiniPort driver wallet top-up",
        testMode: order.keyId.startsWith("rzp_test_"),
      });
      if (!result) return;
      await confirmWalletTopupPayment({ data: {
        orderId: result.razorpay_order_id, paymentId: result.razorpay_payment_id,
        signature: result.razorpay_signature,
      }});
      toast.success("Payment successful. Money has been added to your wallet.");
      void queryClient.invalidateQueries({ queryKey: ["wallet", user?.id] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-txns", user?.id] });
      setOpen(false); setAmount("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Payment failed. Please try again."); }
  };

  return <div className="space-y-2">
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" className="w-full sm:w-auto"><Plus className="h-4 w-4" /> Add Money</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Money to wallet</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {customerMode && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[500, 1000, 2500, 5000].map((preset) => <Button key={preset} type="button" variant={Number(amount) === preset ? "default" : "outline"} onClick={() => setAmount(String(preset))}>+₹{preset.toLocaleString("en-IN")}</Button>)}
          </div>}
          <div>
            <Label htmlFor={customerMode ? "customer-topup-amount" : "driver-topup-amount"}>Amount (₹)</Label>
            <Input id={customerMode ? "customer-topup-amount" : "driver-topup-amount"} inputMode="numeric" min={100} max={100000} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Enter amount" />
            <p className="mt-1 text-xs text-muted-foreground">Minimum ₹100 · maximum ₹100,000</p>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={payOnline}>Proceed to Add Money · ₹{amount || "0"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
