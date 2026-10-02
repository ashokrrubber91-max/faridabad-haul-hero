import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tag, Coins, CreditCard, Loader2, X, Users, ShieldCheck, CalendarClock } from "lucide-react";
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
  helperCount,
  setHelperCount,
  insuranceOpted,
  setInsuranceOpted,
  cargoValue,
  setCargoValue,
  ewayBillNumber,
  setEwayBillNumber,
  scheduledFor,
  setScheduledFor,
}: {
  fare: number;
  promo: { code: string; discount: number } | null;
  setPromo: (p: { code: string; discount: number } | null) => void;
  coins: number;
  setCoins: (n: number) => void;
  method: PaymentMethod;
  setMethod: (m: PaymentMethod) => void;
  helperCount: number;
  setHelperCount: (n: number) => void;
  insuranceOpted: boolean;
  setInsuranceOpted: (v: boolean) => void;
  cargoValue: number;
  setCargoValue: (n: number) => void;
  ewayBillNumber: string;
  setEwayBillNumber: (v: string) => void;
  scheduledFor: string;
  setScheduledFor: (v: string) => void;
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
    const { data, error } = await supabase.rpc("validate_coupon", {
      _code: code.trim(),
      _fare: fare,
    });
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
        <Label className="flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5" /> Promo code
        </Label>
        {promo ? (
          <div className="mt-1 flex items-center justify-between rounded-md border border-success bg-success/10 px-3 py-2 text-sm">
            <span className="font-semibold text-success">
              {promo.code} · −₹{promo.discount}
            </span>
            <button
              onClick={() => setPromo(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="mt-1 flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Try WELCOME50"
              className="uppercase"
            />
            <Button
              type="button"
              variant="outline"
              onClick={applyPromo}
              disabled={checking || !code.trim() || fare <= 0}
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
            </Button>
          </div>
        )}
      </div>

      {/* Coins */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-primary" /> Miniport Coins
          </Label>
          <span className="text-xs text-muted-foreground">Balance: {balance}</span>
        </div>
        {maxCoins > 0 ? (
          <>
            <div className="mt-2 flex items-center gap-3">
              <Slider
                value={[coins]}
                min={0}
                max={maxCoins}
                step={1}
                onValueChange={(v) => setCoins(v[0])}
                className="flex-1"
              />
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={maxCoins}
                value={coins === 0 ? "" : coins}
                placeholder="0"
                onChange={(e) => {
                  const raw = Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0);
                  setCoins(Math.max(0, Math.min(maxCoins, raw)));
                }}
                className="w-24 text-right"
                aria-label="Coins to redeem"
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Enter any amount up to {maxCoins} coins (50% of fare)</span>
              <span className="font-semibold text-success">−₹{coins}</span>
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {balance === 0
              ? "Complete a trip to earn coins (2% cashback)."
              : "Enter pickup/drop to redeem coins."}
          </p>
        )}
      </div>

      {/* Loading helpers */}
      <div>
        <Label className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Loading / unloading help</Label>
        <div className="mt-1 grid gap-1.5">
          {([{n:0,label:"Driver Only (No loading)",fee:0},{n:1,label:"Driver + 1 Helper",fee:250},{n:2,label:"Driver + 2 Helpers",fee:500}]).map((h) => (
            <button key={h.n} type="button" onClick={() => setHelperCount(h.n)} className={`flex items-center justify-between rounded-md border p-2.5 text-left text-sm ${helperCount===h.n ? "border-primary bg-accent" : "border-border hover:bg-muted"}`}>
              <span className="font-medium text-secondary">{h.label}</span><span className="text-xs text-muted-foreground">{h.fee ? "+₹"+h.fee : "₹0"}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Scheduled booking */}
      <div>
        <Label className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> Schedule booking</Label>
        <Input className="mt-1" type="datetime-local" value={scheduledFor} min={new Date(Date.now()+15*60*1000).toISOString().slice(0,16)} onChange={(e) => setScheduledFor(e.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">Leave blank for immediate dispatch. Scheduled jobs enter the driver queue 30 minutes before the selected time.</p>
      </div>

      {/* Cargo insurance + GST/E-way data */}
      <div className="space-y-3">
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={insuranceOpted} onChange={(e) => setInsuranceOpted(e.target.checked)} />
          <span><span className="flex items-center gap-1 font-semibold text-secondary"><ShieldCheck className="h-4 w-4 text-primary" /> Insure cargo up to ₹50,000</span><span className="text-xs text-muted-foreground">+₹10 cargo micro-insurance</span></span>
        </label>
        <div>
          <Label htmlFor="cargo-value">Cargo value (₹)</Label>
          <Input id="cargo-value" type="number" min={0} value={cargoValue || ""} onChange={(e) => setCargoValue(Math.max(0, Number(e.target.value) || 0))} placeholder="Optional" />
        </div>
        {cargoValue > 50000 && (
          <div>
            <Label htmlFor="eway-number">E-Way Bill number <span className="text-destructive">*</span></Label>
            <Input id="eway-number" value={ewayBillNumber} onChange={(e) => setEwayBillNumber(e.target.value.toUpperCase().slice(0, 30))} placeholder="Enter E-Way Bill number" />
            <p className="mt-1 text-xs text-muted-foreground">Required for shipments valued over ₹50,000.</p>
          </div>
        )}
      </div>

      {/* Payment method */}
      <div>
        <Label className="flex items-center gap-1.5">
          <CreditCard className="h-3.5 w-3.5" /> Payment method
        </Label>
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
