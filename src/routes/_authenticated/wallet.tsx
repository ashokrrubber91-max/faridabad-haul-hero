import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Building2, Coins, Loader2, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet & earnings — MiniPort" },
      { name: "description", content: "MiniPort wallet: coin rewards, trip earnings, bank payouts and your full transaction ledger." },
      { property: "og:title", content: "Wallet & earnings — MiniPort" },
      { property: "og:description", content: "Track MiniPort coins, cash balance, payouts and every wallet transaction." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WalletPage,
});

function WalletPage() {
  const { user, role, activeMode } = useAuth();
  const qc = useQueryClient();
  const isDriver = role === "driver" || activeMode === "driver";

  const wallet = useQuery({
    queryKey: ["wallet", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("wallet_accounts")
        .select("cash_balance,coins_balance")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data ?? { cash_balance: 0, coins_balance: 0 };
    },
  });

  const txns = useQuery({
    queryKey: ["wallet-txns", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const banks = useQuery({
    queryKey: ["bank-accounts", user?.id],
    enabled: !!user && isDriver,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_bank_accounts")
        .select("*")
        .eq("driver_id", user!.id)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const withdrawals = useQuery({
    queryKey: ["withdrawals", user?.id],
    enabled: !!user && isDriver,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("withdrawal_requests")
        .select("*")
        .eq("driver_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const cash = Number(wallet.data?.cash_balance ?? 0);
  const coins = Number(wallet.data?.coins_balance ?? 0);

  const monthNet = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return (txns.data ?? [])
      .filter((t) => new Date(t.created_at) >= start)
      .reduce((sum, t) => sum + Number(t.delta), 0);
  }, [txns.data]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-secondary">{isDriver ? "Earnings" : "Wallet"}</h1>
        <p className="text-sm text-muted-foreground">
          {isDriver ? "Trip payouts, commission deductions and withdrawals." : "MiniPort coins and payment history."}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="surface-card p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {isDriver ? "Available for withdrawal" : "Wallet balance"}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            <p className="font-display text-4xl text-secondary">₹{cash.toFixed(2)}</p>
          </div>
          {isDriver && cash < 100 && (
            <p className="mt-2 rounded-md bg-warning/15 px-3 py-2 text-xs text-warning-foreground">
              Keep at least ₹100 in your wallet to keep receiving cash-on-delivery jobs.
            </p>
          )}
          {isDriver ? (
            <WithdrawDialog
              cash={cash}
              banks={banks.data ?? []}
              onDone={() => {
                qc.invalidateQueries({ queryKey: ["withdrawals", user?.id] });
                qc.invalidateQueries({ queryKey: ["wallet", user?.id] });
              }}
            />
          ) : (
            <Button className="mt-4 w-full sm:w-auto" onClick={() => toast.info("UPI & card top-ups are coming soon")}>
              <Plus className="h-4 w-4" /> Add money
            </Button>
          )}
        </section>

        <section className="surface-card p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {isDriver ? "Net this month" : "MiniPort coins"}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <Coins className="h-6 w-6 text-warning" />
            <p className="font-display text-4xl text-secondary">
              {isDriver ? `₹${monthNet.toFixed(0)}` : coins.toFixed(0)}
            </p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {isDriver
              ? "Trip earnings and incentives credited since the 1st, after MiniPort commission."
              : "1 coin = ₹1 off. Earn 2% cashback on every completed trip; redeem up to 50% of a fare."}
          </p>
        </section>
      </div>

      {isDriver && <BankAccounts userId={user?.id} accounts={banks.data ?? []} loading={banks.isLoading} />}

      {isDriver && (withdrawals.data ?? []).length > 0 && (
        <section className="surface-card p-5">
          <h2 className="mb-3 font-display text-xl tracking-wide text-secondary">Withdrawal requests</h2>
          <ul className="divide-y divide-border">
            {(withdrawals.data ?? []).map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-semibold text-secondary">₹{Number(w.amount).toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">{new Date(w.created_at).toLocaleString()}</p>
                </div>
                <span
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    w.status === "paid"
                      ? "bg-success/15 text-success"
                      : w.status === "rejected"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-warning/15 text-warning-foreground"
                  }`}
                >
                  {w.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-2xl tracking-wide text-secondary">Transaction history</h2>
        {txns.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (txns.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isDriver ? "No transactions yet. Complete a trip to start earning." : "No transactions yet. Book a trip to earn coins."}
          </p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
            {(txns.data ?? []).map((t) => {
              const positive = Number(t.delta) >= 0;
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        positive ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {positive ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-secondary">{t.reason}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(t.created_at).toLocaleString()}
                        {t.booking_id ? ` · Trip #${t.booking_id.slice(0, 8)}` : ""}
                      </p>
                    </div>
                  </div>
                  <p className={`font-display text-lg ${positive ? "text-success" : "text-destructive"}`}>
                    {positive ? "+" : ""}₹{Number(t.delta).toFixed(0)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

type Bank = {
  id: string;
  account_holder: string;
  bank_name: string;
  account_number: string;
  ifsc: string;
  upi_id: string | null;
  is_default: boolean;
};

function BankAccounts({ userId, accounts, loading }: { userId?: string; accounts: Bank[]; loading: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [holder, setHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [acc, setAcc] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [upi, setUpi] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      if (holder.trim().length < 2) throw new Error("Enter the account holder name");
      if (bankName.trim().length < 2) throw new Error("Enter the bank name");
      if (acc.trim().length < 8) throw new Error("Enter a valid account number");
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) throw new Error("Enter a valid IFSC code");
      const upiId = upi.trim();
      if (upiId && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) throw new Error("Enter a valid UPI ID");
      const { error } = await supabase.from("driver_bank_accounts").insert({
        driver_id: userId!,
        account_holder: holder.trim(),
        bank_name: bankName.trim(),
        account_number: acc.trim(),
        ifsc: ifsc.trim().toUpperCase(),
        upi_id: upiId || null,
        is_default: accounts.length === 0,
      });
      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Payout method saved");
      setOpen(false);
      setHolder("");
      setBankName("");

      setAcc("");
      setIfsc("");
      setUpi("");
      qc.invalidateQueries({ queryKey: ["bank-accounts", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="surface-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
          <Building2 className="h-4 w-4 text-primary" /> Payout methods
        </h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add bank account or UPI</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="b-holder">Account holder name</Label>
                <Input id="b-holder" value={holder} onChange={(e) => setHolder(e.target.value)} maxLength={60} />
              </div>
              <div>
                <Label htmlFor="b-bank">Bank name</Label>
                <Input id="b-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={60} />
              </div>
              <div className="grid grid-cols-2 gap-3">

                <div>
                  <Label htmlFor="b-acc">Account number</Label>
                  <Input id="b-acc" inputMode="numeric" value={acc} onChange={(e) => setAcc(e.target.value)} maxLength={20} />
                </div>
                <div>
                  <Label htmlFor="b-ifsc">IFSC</Label>
                  <Input
                    id="b-ifsc"
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    maxLength={11}
                    placeholder="HDFC0001234"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="b-upi">or UPI ID</Label>
                <Input id="b-upi" value={upi} onChange={(e) => setUpi(e.target.value)} maxLength={60} placeholder="name@upi" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => add.mutate()} disabled={add.isPending}>
                {add.isPending ? "Saving…" : "Save method"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add a bank account or UPI ID to withdraw your earnings.</p>
      ) : (
        <ul className="divide-y divide-border">
          {accounts.map((b) => (
            <li key={b.id} className="py-2.5 text-sm">
              <p className="font-semibold text-secondary">{b.account_holder}</p>
              <p className="text-xs text-muted-foreground">
                {b.upi_id ? b.upi_id : `${(b.account_number ?? "").replace(/.(?=.{4})/g, "•")} · ${b.ifsc}`}
                {b.is_default ? " · default" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WithdrawDialog({ cash, banks, onDone }: { cash: number; banks: Bank[]; onDone: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!banks.length) throw new Error("Add a payout method first");
      if (!amt || amt < 100) throw new Error("Minimum withdrawal is ₹100");
      if (amt > cash) throw new Error("Amount exceeds your available balance");
      const target = banks.find((b) => b.is_default) ?? banks[0];
      const { error } = await supabase.from("withdrawal_requests").insert({
        driver_id: user!.id,
        amount: amt,
        method: target.upi_id ? "upi" : "bank",
        note: target.upi_id ?? `${target.bank_name} ****${target.account_number.slice(-4)}`,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Withdrawal requested — processed within 24 hours");
      setOpen(false);
      setAmount("");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="mt-4 w-full sm:w-auto">
          <Building2 className="h-4 w-4" /> Withdraw to bank / UPI
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw earnings</DialogTitle>
        </DialogHeader>
        <div>
          <Label htmlFor="w-amt">Amount (₹)</Label>
          <Input id="w-amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">Available ₹{cash.toFixed(2)} · minimum ₹100</p>
        </div>
        <DialogFooter>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Requesting…" : "Request withdrawal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
