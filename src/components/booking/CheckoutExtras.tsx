import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tag, Coins, CreditCard, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);

  const wallet = useQuery({
    queryKey: ["wallet", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("wallet_accounts")
        .select("coins_balance")
        .eq("user_id", user!.id)
        .maybeSingle();
      return Number(data?.coins_balance ?? 0);
    },
  });

  const balance = wallet.data ?? 0;
  const maxCoins = Math.min(balance, Math.floor(fare * 0.5));

  const applyPromo = async () => {
    if (!code.trim()) return;
    setChecking(true);
    const { data, error } = await supabase.rpc("validate_coupon", { _code: code.trim(), _fare: fare });
    setChecking(false);
    if (error) return toast.error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.message !== "ok") return toast.error(row?.message || "Invalid code");
    setPromo({ code: row.code, discount: Number(row.discount) });
    toast.success(`₹${row.discount} off applied`);
  };

  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/30 p-4">
      {/* Promo */}
      <div>
        <Label className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> Promo code</Label>
        {promo ? (
          <div className="mt-1 flex items-center justify-between rounded-md border border-success bg-success/10 px-3 py-2 text-sm">
            <span className="font-semibold text-success">{promo.code} · −₹{promo.discount}</span>
            <button onClick={() => setPromo(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <div className="mt-1 flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Try WELCOME50"
              className="uppercase"
            />
            <Button type="button" variant="outline" onClick={applyPromo} disabled={checking || !code.trim() || fare <= 0}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
            </Button>
          </div>
        )}
      </div>

      {/* Coins */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5"><Coins className="h-3.5 w-3.5 text-primary" /> Miniport Coins</Label>
          <span className="text-xs text-muted-foreground">Balance: {balance}</span>
        </div>
        {maxCoins > 0 ? (
          <div className="mt-2 flex items-center gap-3">
            <Slider value={[coins]} min={0} max={maxCoins} step={1} onValueChange={(v) => setCoins(v[0])} className="flex-1" />
            <span className="w-16 text-right text-sm font-semibold">−₹{coins}</span>
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {balance === 0 ? "Complete a trip to earn coins (2% cashback)." : "Enter pickup/drop to redeem coins."}
          </p>
        )}
      </div>

      {/* Payment method */}
      <div>
        <Label className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Payment method</Label>
        <div className="mt-1 grid gap-1.5">
          {METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={!m.available}
              onClick={() => setMethod(m.id)}
              className={`flex items-center justify-between rounded-md border p-2.5 text-left text-sm transition-colors ${
                method === m.id ? "border-primary bg-accent" : "border-border"
              } ${!m.available ? "opacity-50 cursor-not-allowed" : "hover:bg-muted"}`}
            >
              <span className="font-medium text-secondary">{m.label}</span>
              <span className="text-xs text-muted-foreground">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
