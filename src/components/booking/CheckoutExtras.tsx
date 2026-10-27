import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { OffersCoins } from "@/components/booking/OffersCoins";

export type PaymentMethod = "cod" | "wallet" | "upi" | "card" | "netbanking";

const METHODS: { id: PaymentMethod; label: string; hint: string; available: boolean }[] = [
  { id: "upi", label: "UPI", hint: "GPay · PhonePe · Paytm", available: true },
  { id: "card", label: "Credit / Debit card", hint: "Visa · Mastercard · RuPay", available: true },
  { id: "netbanking", label: "Netbanking", hint: "All major banks", available: true },
  { id: "wallet", label: "Wallet / Miniport Coins", hint: "Use coin balance", available: true },
  { id: "cod", label: "Cash on delivery", hint: "Pay driver in cash", available: true },
];

export function CheckoutExtras({
  fare,
  promo,
  setPromo,
  coins,
  setCoins,
  method,
  setMethod,
}: {
  fare: number;
  promo: { code: string; discount: number } | null;
  setPromo: (p: { code: string; discount: number } | null) => void;
  coins: number;
  setCoins: (n: number) => void;
  method: PaymentMethod;
  setMethod: (m: PaymentMethod) => void;
}) {
  return (
    <div className="space-y-4">
      <OffersCoins fare={fare} promo={promo} setPromo={setPromo} coins={coins} setCoins={setCoins} />

      {/* Payment method */}
      <div>
        <Label className="flex items-center gap-1.5">
          <CreditCard className="h-3.5 w-3.5" /> Payment method
        </Label>
        <div className="mt-1 grid gap-1.5">
          {METHODS.map((m) => (
            <Button
              key={m.id}
              type="button"
              disabled={!m.available}
              onClick={() => setMethod(m.id)}
              variant="outline"
              aria-pressed={method === m.id}
              className={`h-auto flex-wrap items-center justify-between gap-1 rounded-md border p-2.5 text-left text-sm transition-colors ${
                method === m.id ? "border-primary bg-accent" : "border-border"
              } ${!m.available ? "opacity-50 cursor-not-allowed" : "hover:bg-muted"}`}
            >
              <span className="font-medium text-secondary">{m.label}</span>
              <span className="text-xs text-muted-foreground">{m.hint}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
