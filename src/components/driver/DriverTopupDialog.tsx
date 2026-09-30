import { useState } from "react";
import { CreditCard, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { createWalletTopupOrder, confirmWalletTopupPayment, getPaymentConfig } from "@/lib/payments.functions";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";

export function DriverTopupDialog() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const payOnline = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 100) {
      toast.error("Minimum Add Money amount is ₹100");
      return;
    }
    if (value > 100000) {
      toast.error("Maximum Add Money amount is ₹100,000");
      return;
    }

    try {
      const config = await getPaymentConfig();
      if (!config.configured || !config.keyId) throw new Error("Online payments are not configured yet.");

      const order = await createWalletTopupOrder({ data: { amount: value } });
      const result = await openRazorpayCheckout({
        keyId: order.keyId,
        orderId: order.orderId,
        amountRupees: order.amount,
        currency: order.currency,
        customerPhone: user?.phone ?? "",
        description: "MiniPort driver wallet top-up",
      });
      if (!result) return;

      await confirmWalletTopupPayment({
        data: {
          orderId: result.razorpay_order_id,
          paymentId: result.razorpay_payment_id,
          signature: result.razorpay_signature,
        },
      });

      toast.success("Payment successful. Money has been added to your wallet.");
      setOpen(false);
      setAmount("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment failed. Please try again.");
    }
  };

  return (
    <div className="space-y-2">
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
              <p className="mt-1 text-xs text-muted-foreground">Minimum ₹100 · maximum ₹100,000</p>
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p>
                  Pay online just like a booking. Razorpay will open the secure payment screen.
                  After successful payment, the amount is credited directly to your MiniPort wallet.
                  No admin approval is required.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={payOnline}>
              Pay ₹{amount || "0"} Online
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
