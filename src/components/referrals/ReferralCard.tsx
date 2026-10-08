import type { SupabaseClient as UntypedClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Gift, MessageCircle, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type ReferralRow = {
  id: string;
  status: "pending" | "rewarded" | "invalid" | string;
  referred_type: "customer" | "driver" | string;
  reward_amount: number;
  created_at: string;
  rewarded_at: string | null;
};

export function ReferralCard() {
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [profileResult, referralsResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("referral_code")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("referrals")
          .select("id,status,referred_type,reward_amount,created_at,rewarded_at")
          .eq("referrer_id", user.id)
          .order("created_at", { ascending: false }),
      ]);

      if (profileResult.error) throw profileResult.error;
      if (referralsResult.error) throw referralsResult.error;

      let next = profileResult.data?.referral_code ?? "";
      if (!next.trim()) {
        const { data: made, error: makeError } = await supabase.rpc(
          "ensure_my_referral_code" as never,
        );
        if (makeError) throw makeError;
        next = (made as unknown as string) ?? "";
      }
      console.log("[MiniPort referral] referral_code:", next || null);
      setCode(next);
      setRows((referralsResult.data ?? []) as ReferralRow[]);
    } catch {
      toast.error("Could not load referral details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [user?.id]);

  const link = useMemo(() => {
    if (!code || typeof window === "undefined") return "";
    return `${window.location.origin}/auth?mode=signup&ref=${encodeURIComponent(code)}`;
  }, [code]);

  const rewarded = rows.filter((r) => r.status === "rewarded");
  const pending = rows.filter((r) => r.status === "pending");
  const earned = rewarded.reduce((sum, r) => sum + Number(r.reward_amount || 0), 0);

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Referral link copied");
    setTimeout(() => setCopied(false), 1800);
  };

  const copyCode = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    toast.success("Referral code copied");
  };

  const share = async () => {
    if (!link) return;
    const text = "Join me on MiniPort. Use my referral link and sign up: " + link;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Join MiniPort", text, url: link });
      } else {
        window.open(
          `https://wa.me/?text=${encodeURIComponent(text)}`,
          "_blank",
          "noopener,noreferrer",
        );
      }
    } catch {
      // User closed the native share sheet; no error toast needed.
    }
  };

  return (
    <section className="surface-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
            <Gift className="h-5 w-5 text-primary" /> Refer & Earn
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Earn <span className="font-semibold text-secondary">₹100</span> for every successful
            referral. No invite limit.
          </p>
        </div>
        <Users className="h-5 w-5 text-primary" />
      </div>

      <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Your referral code</p>
        <p className="mt-1 font-mono text-xl font-bold tracking-[0.18em] text-secondary">
          {loading ? "Loading…" : code || "Not available — tap retry"}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-muted/40 p-2">
          <p className="text-lg font-bold text-secondary">{rows.length}</p>
          <p className="text-[11px] text-muted-foreground">Invites</p>
        </div>
        <div className="rounded-md bg-success/10 p-2">
          <p className="text-lg font-bold text-success">{rewarded.length}</p>
          <p className="text-[11px] text-muted-foreground">Rewarded</p>
        </div>
        <div className="rounded-md bg-warning/10 p-2">
          <p className="text-lg font-bold text-warning-foreground">{pending.length}</p>
          <p className="text-[11px] text-muted-foreground">Pending</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Customer referral: ₹100 after their first ride is booked. Driver referral: ₹100 after their
        first ride is completed. Each invited account can qualify only once.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={copyCode} disabled={!code} variant="outline" className="gap-2">
          <Copy className="h-4 w-4" /> Copy code
        </Button>
        <Button onClick={share} disabled={!code} className="gap-2">
          <Share2 className="h-4 w-4" /> Share referral
        </Button>
        <Button onClick={copyLink} disabled={!code} variant="outline" className="gap-2">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        {code && (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() =>
              window.open(
                `https://wa.me/?text=${encodeURIComponent(
                  `Join me on MiniPort and use my referral link: ${link}`,
                )}`,
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            <MessageCircle className="h-4 w-4" /> Share via WhatsApp
          </Button>
        )}
      </div>

      {!loading && !code && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => void load()}>
          Retry
        </Button>
      )}
      <p className="mt-3 text-xs font-medium text-secondary">
        Total referral earnings: ₹{earned.toFixed(0)} · {rewarded.length} successful referral
        {rewarded.length === 1 ? "" : "s"}
      </p>
    </section>
  );
}
