import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Coins, Loader2, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { coinsToRedeem } from "@/lib/booking-discounts";

export type Promo = { code: string; discount: number };
export type OffersCoinsProps = {
  fare: number;
  promo: Promo | null;
  setPromo: (value: Promo | null) => void;
  coins: number;
  setCoins: (value: number) => void;
};

export function OffersCoins({ fare, promo, setPromo, coins, setCoins }: OffersCoinsProps) {
  const { user } = useAuth();
  const wallet = useWalletBalances();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const balance = wallet.data?.coins;
  const maxCoins = coinsToRedeem(Number.MAX_SAFE_INTEGER, balance ?? 0, fare, promo?.discount ?? 0);

  useEffect(() => {
    if (balance === undefined) return;
    const allowed = coinsToRedeem(coins, balance, fare, promo?.discount ?? 0);
    if (allowed !== coins) setCoins(allowed);
  }, [balance, coins, fare, promo?.discount, setCoins]);

  const offers = useQuery({
    queryKey: ["eligible-booking-offers", user?.id, fare],
    enabled: open && !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coupons")
        .select("code,kind,value,min_fare,max_discount,expires_at")
        .eq("active", true)
        .order("code");
      if (error) throw error;
      const now = Date.now();
      const candidates = (data ?? []).filter(
        (offer) => !offer.expires_at || new Date(offer.expires_at).getTime() > now,
      );
      return Promise.all(
        candidates.map(async (offer) => {
          const { data: result, error: validationError } = await supabase.rpc("validate_coupon", {
            _code: offer.code,
            _fare: fare,
          });
          if (validationError) throw validationError;
          const row = Array.isArray(result) ? result[0] : result;
          return {
            ...offer,
            discount: Number(row?.discount ?? 0),
            eligible: row?.message === "ok",
            message: row?.message ?? "Not available for this booking",
          };
        }),
      );
    },
  });

  // Recheck an applied offer when the route, vehicle or extras change.
  useEffect(() => {
    if (!promo) return;
    let cancelled = false;
    void supabase
      .rpc("validate_coupon", { _code: promo.code, _fare: fare })
      .then(({ data, error }) => {
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        if (error || row?.message !== "ok") {
          setPromo(null);
          return;
        }
        const discount = Number(row.discount);
        if (discount !== promo.discount) setPromo({ code: row.code, discount });
      });
    return () => {
      cancelled = true;
    };
  }, [fare, promo, setPromo]);

  const apply = async (value: string) => {
    if (checking || !value.trim() || fare <= 0) return;
    setChecking(true);
    setCodeError(null);
    try {
      const { data, error } = await supabase.rpc("validate_coupon", {
        _code: value.trim().toUpperCase(),
        _fare: fare,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.message !== "ok")
        throw new Error(row?.message || "This code is not available for this booking.");
      setPromo({ code: row.code, discount: Number(row.discount) });
      toast.success(`₹${row.discount} off applied`);
    } catch (error) {
      setCodeError(
        error instanceof Error ? error.message : "Could not check this code. Please retry.",
      );
    } finally {
      setChecking(false);
    }
  };

  const savings = (promo?.discount ?? 0) + coins;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-16 w-full justify-between whitespace-normal px-4 py-3 text-left"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Coins className="text-primary" />
          <span>
            <span className="block font-semibold">Offers &amp; Coins</span>
            <span className="block text-xs text-muted-foreground">
              {savings > 0
                ? `₹${savings} savings applied`
                : wallet.isPending
                  ? "Loading coin balance…"
                  : wallet.isError
                    ? "Coin balance unavailable"
                    : `${balance ?? 0} coins available`}
            </span>
          </span>
        </span>
        <ChevronRight />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[90dvh] max-w-xl overflow-y-auto rounded-t-lg pb-8"
        >
          <SheetHeader className="pr-8 text-left">
            <SheetTitle>Offers &amp; Coins</SheetTitle>
            <SheetDescription>
              {savings > 0 ? `₹${savings} saved on this booking` : "Available for this booking"}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="redeem-booking-coins" className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-primary" /> MiniPort Coins
                </Label>
                <span className="text-sm font-semibold">
                  {wallet.isPending
                    ? "Loading…"
                    : wallet.isError
                      ? "Unavailable"
                      : `${balance ?? 0} coins`}
                </span>
              </div>
              {wallet.isError ? (
                <div role="alert" className="space-y-2 text-sm">
                  <p>Couldn’t load your balance.</p>
                  <Button size="sm" variant="outline" onClick={() => void wallet.refetch()}>
                    Retry balance
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      id="redeem-booking-coins"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={maxCoins}
                      step={1}
                      value={coins || ""}
                      placeholder="0"
                      disabled={balance === undefined || maxCoins === 0}
                      onChange={(event) =>
                        setCoins(
                          coinsToRedeem(
                            Number(event.target.value),
                            balance ?? 0,
                            fare,
                            promo?.discount ?? 0,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="outline"
                      disabled={maxCoins === 0}
                      onClick={() => setCoins(maxCoins)}
                    >
                      Use max
                    </Button>
                  </div>
                  <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                    <span>1 coin = ₹1 · Up to {maxCoins} coins</span>
                    <span className="font-semibold text-success">−₹{coins}</span>
                  </div>
                </>
              )}
            </section>
            <section className="space-y-3 border-t pt-4">
              <Label htmlFor="booking-promo-code">Promo code</Label>
              <div className="flex gap-2">
                <Input
                  id="booking-promo-code"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.toUpperCase());
                    setCodeError(null);
                  }}
                  placeholder="Enter promo code"
                  maxLength={40}
                />
                <Button
                  onClick={() => void apply(code)}
                  disabled={checking || !code.trim() || fare <= 0}
                >
                  {checking ? <Loader2 className="animate-spin" /> : "Apply"}
                </Button>
              </div>
              {codeError && (
                <p role="alert" className="text-sm text-destructive">
                  {codeError}
                </p>
              )}
              {promo && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-success/40 bg-success/5 p-3 text-sm">
                  <span className="text-success">
                    {promo.code} · −₹{promo.discount}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove promo"
                    onClick={() => setPromo(null)}
                  >
                    <X />
                  </Button>
                </div>
              )}
              <h3 className="text-sm font-semibold">Available offers</h3>
              {offers.isPending ? (
                <p className="text-sm text-muted-foreground">Loading offers…</p>
              ) : offers.isError ? (
                <div role="alert" className="space-y-2">
                  <p className="text-sm text-muted-foreground">Couldn’t load offers.</p>
                  <Button size="sm" variant="outline" onClick={() => void offers.refetch()}>
                    Retry offers
                  </Button>
                </div>
              ) : offers.data?.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active promo codes right now.</p>
              ) : (
                <div className="space-y-2">
                  {offers.data?.map((offer) => (
                    <div
                      key={offer.code}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 break-all text-sm font-semibold">
                          <Tag className="h-4 w-4 shrink-0 text-primary" />
                          {offer.code}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {offer.eligible ? `Save ₹${offer.discount}` : offer.message}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!offer.eligible || checking || promo?.code === offer.code}
                        onClick={() => void apply(offer.code)}
                      >
                        {promo?.code === offer.code ? "Applied" : "Apply"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <div className="flex justify-between border-t pt-4 text-sm font-semibold">
              <span>Final booking fare</span>
              <span>₹{Math.max(0, fare - savings)}</span>
            </div>
            <Button className="w-full" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
