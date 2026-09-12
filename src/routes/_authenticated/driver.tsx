import type { AnyRow } from "@/lib/rows";
import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Timer,
  ArrowRight,
  Loader2,
  MapPin,
  Truck,
  Wifi,
  WifiOff,
  Phone,
  Wallet,
  Trophy,
  AlertTriangle,
  IndianRupee,
  ShieldCheck,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PushAlertToggle } from "@/components/driver/PushAlertToggle";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { vehicleLabel, STATUS_META, BOOKING_FIELDS } from "@/lib/booking";
import { SupportChat } from "@/components/support/SupportChat";
import { IncomingRideOverlay } from "@/components/driver/IncomingRideOverlay";
import { LoadingTimerCard } from "@/components/booking/LoadingTimerCard";
import { sweepStaleBookings } from "@/lib/notifications.functions";

export const Route = createFileRoute("/_authenticated/driver")({
  head: () => ({ meta: [{ title: "Driver — MiniPort" }] }),
  component: DriverPage,
});

type IncentiveTier = { rides_required: number; bonus_amount: number; label: string };

function DriverPage() {
  const { user, role, roles, activeMode, profile, loading } = useAuth();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState<string[]>([]);

  const setOnline = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_online: next })
        .eq("id", user!.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => toast.success(next ? "You're online — receiving jobs" : "You're offline"),
    onError: (e: Error) => toast.error(e.message),
  });

  const sweepStale = useServerFn(sweepStaleBookings);

  const queue = useQuery({
    queryKey: ["driver-feed", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Sweep requests whose validity window has passed so the feed never shows
      // a request the backend would refuse to assign. Runs server-side: the
      // cleanup function is not directly executable by signed-in users.
      await sweepStale({ data: undefined }).catch(() => undefined);
      const { data, error } = await supabase
        .from("bookings")
        .select(BOOKING_FIELDS)
        .or(
          `and(status.eq.pending,driver_id.is.null,cancelled_at.is.null),driver_id.eq.${user!.id}`,
        )
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });

  const wallet = useQuery({
    queryKey: ["driver-wallet", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("wallet_accounts")
        .select("cash_balance")
        .eq("user_id", user!.id)
        .maybeSingle();
      return Number(data?.cash_balance ?? 0);
    },
  });

  const tiers = useQuery({
    queryKey: ["incentive-tiers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("driver_incentive_config")
        .select("rides_required,bonus_amount,label")
        .eq("active", true)
        .order("rides_required");
      return (data ?? []) as IncentiveTier[];
    },
  });

  const refreshFeed = useCallback(() => {
    if (!user) return;
    qc.invalidateQueries({ queryKey: ["driver-feed", user.id] });
  }, [qc, user]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("driver-bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, (payload) => {
        qc.invalidateQueries({ queryKey: ["driver-feed", user.id] });
        qc.invalidateQueries({ queryKey: ["driver-wallet", user.id] });
        const next = payload.new as {
          status?: string;
          driver_id?: string | null;
          service_zone?: string;
        };
        const eligibleForAlert =
          profile?.is_online === true &&
          profile.kyc_status === "approved" &&
          profile.service_zone === (next.service_zone ?? "Faridabad");
        if (
          payload.eventType === "INSERT" &&
          next.status === "pending" &&
          !next.driver_id &&
          eligibleForAlert
        ) {
          toast.info("New ride request", {
            description: `${next.service_zone ?? "Faridabad"} zone · open Live requests`,
          });
          playRideAlert();
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          refreshFeed();
        }
      });

    // Reconnect handling: refresh the queue when the phone comes back online or
    // the app returns to the foreground. Nothing is fetched while hidden.
    const recover = () => {
      if (document.visibilityState === "visible") refreshFeed();
    };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recover);
      supabase.removeChannel(ch);
    };
  }, [user, profile, qc, refreshFeed]);

  const accept = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("accept_booking", { _booking_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("You've got the job!");
      void qc.invalidateQueries({ queryKey: ["driver-feed", user?.id] });
    },
    onError: (e: Error) => {
      toast.error(e.message.includes("already") ? "Ride already accepted or closed" : e.message);
      void qc.invalidateQueries({ queryKey: ["driver-feed", user?.id] });
    },
  });

  const decline = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("decline_booking", { _booking_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Ride passed");
      void qc.invalidateQueries({ queryKey: ["driver-feed", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  type TimerPatch = {
    loading_started_at?: string;
    loading_stopped_at?: string;
    unloading_started_at?: string;
    unloading_stopped_at?: string;
  };
  const setTimer = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TimerPatch }) => {
      const { error } = await supabase.from("bookings").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Timer updated");
      void qc.invalidateQueries({ queryKey: ["driver-feed", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Codes are never sent to the browser: the database checks them, limits wrong
  // tries and moves the trip forward in one atomic step.
  const verifyOtp = useMutation({
    mutationFn: async ({
      id,
      otp,
      next,
      podPath,
    }: {
      id: string;
      otp: string;
      next: "in_progress" | "completed";
      podPath?: string | null;
    }) => {
      const code = otp.replace(/\D/g, "");
      if (code.length !== 4) throw new Error("Enter the 4-digit code from the customer");
      // The photo is evidence only — it can never replace the customer's code.
      if (podPath) {
        const { error: podError } = await supabase.rpc("attach_delivery_photo", {
          _booking_id: id,
          _pod_path: podPath,
        });
        if (podError) throw podError;
      }
      const { data, error } = await supabase.rpc("verify_booking_otp", {
        _booking_id: id,
        _stage: next === "in_progress" ? "pickup" : "drop",
        _otp: code,
      });
      if (error) throw error;
      const result = (data ?? {}) as { ok?: boolean; message?: string };
      if (!result.ok) throw new Error(result.message || "Could not verify this code");
    },
    onSuccess: (_d, v) => {
      toast.success(
        v.next === "in_progress"
          ? "Pickup verified — trip started"
          : "Delivery confirmed — trip completed 🎉",
      );
      void qc.invalidateQueries({ queryKey: ["driver-feed", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading)
    return (
      <Center>
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </Center>
    );
  if (role && role !== "driver" && role !== "admin") return <Navigate to="/customer" />;
  if (
    role !== "admin" &&
    roles.includes("driver") &&
    roles.includes("customer") &&
    activeMode === "customer"
  ) {
    return <Navigate to="/customer" />;
  }

  const pending = (queue.data ?? []).filter(
    (b) => b.status === "pending" && !b.driver_id && !b.cancelled_at,
  );
  const mine = (queue.data ?? []).filter((b) => b.driver_id === user?.id && b.status !== "pending");
  const isOnline = setOnline.variables ?? profile?.is_online ?? false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCompleted = mine.filter(
    (b) => b.status === "completed" && new Date(b.updated_at ?? b.created_at) >= today,
  );
  const todayEarnings = todayCompleted.reduce(
    (sum, b) => sum + Number(b.driver_net_earning || b.fare || 0),
    0,
  );
  const ridesToday = todayCompleted.length;
  const activeJob = mine.find((b) => b.status === "accepted" || b.status === "in_progress");

  const cash = wallet.data ?? 0;
  const walletLow = cash < 100;

  // Incentive milestone calc
  const sortedTiers = tiers.data ?? [];
  const topTarget = sortedTiers[sortedTiers.length - 1]?.rides_required ?? 10;
  const nextTier = sortedTiers.find((t) => t.rides_required > ridesToday);
  const earnedTier = [...sortedTiers].reverse().find((t) => t.rides_required <= ridesToday);
  const earnedToday = earnedTier?.bonus_amount ?? 0;

  const kycStatus = profile?.kyc_status ?? "not_submitted";
  const kycVerified = kycStatus === "approved" || role === "admin";

  // Full-screen incoming-ride alert: only when verified, online, free, and not dismissed.
  const incoming =
    kycVerified && isOnline && !activeJob
      ? pending.find((b) => !dismissed.includes(b.id))
      : undefined;

  return (
    <div className="space-y-6">
      {!kycVerified && (
        <div className="surface-card flex items-start gap-3 border-l-4 border-l-primary bg-primary/5 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-secondary">
              {kycStatus === "pending"
                ? "Verification pending — admin will review within 24 hours"
                : kycStatus === "rejected"
                  ? "Your KYC was rejected — please re-submit documents"
                  : "Complete driver verification to start receiving jobs"}
            </p>
            <p className="text-xs text-muted-foreground">
              Upload your licence, RC, ID proof and vehicle photo.
            </p>
          </div>
          <Button asChild size="sm">
            <Link to="/driver-kyc">
              {kycStatus === "not_submitted" ? "Start KYC" : "View status"}
            </Link>
          </Button>
        </div>
      )}
      {walletLow && (
        <div className="surface-card flex items-start gap-3 border-l-4 border-l-warning bg-warning/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-secondary">Wallet balance low (₹{cash.toFixed(0)})</p>
            <p className="text-xs text-muted-foreground">
              Minimum wallet balance of ₹100 is required to receive new jobs. Please top-up your
              wallet.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/wallet">Top up</Link>
          </Button>
        </div>
      )}

      <section className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          {isOnline ? (
            <Wifi className="h-5 w-5 text-success" />
          ) : (
            <WifiOff className="h-5 w-5 text-muted-foreground" />
          )}
          <div>
            <p className="font-display text-base tracking-wide text-secondary">
              {isOnline
                ? "You're online — receiving jobs nearby"
                : "You're offline — Go online to receive jobs"}
            </p>
            <p className="text-xs text-muted-foreground">
              {activeJob ? "🔒 Locked — active trip in progress" : "Faridabad zone"}
            </p>
          </div>
        </div>
        <Switch
          checked={isOnline}
          onCheckedChange={(v) => {
            if (activeJob && !v) {
              toast.error(
                "You cannot go offline while on an active trip. Please complete the trip first.",
              );
              return;
            }
            setOnline.mutate(v);
          }}
          disabled={setOnline.isPending || !!activeJob}
          aria-label="Toggle online"
        />
      </section>

      <PushAlertToggle />

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Today's Earnings" value={`₹${todayEarnings.toFixed(0)}`} />
        <StatCard label="Trips Completed" value={String(ridesToday)} />
        <StatCard label="Incentive Progress" value={`${ridesToday}/${topTarget}`} />
        <Link
          to="/wallet"
          className="surface-card flex flex-col justify-between p-3 transition-colors hover:bg-muted"
        >
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Wallet</p>
          <p className="font-display text-2xl text-secondary">
            <Wallet className="mr-1 inline h-5 w-5 text-primary" />₹{cash.toFixed(0)}
          </p>
        </Link>
      </section>

      {/* Incentive card */}
      <section className="surface-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <h2 className="font-display text-xl tracking-wide text-secondary">Today's target</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {ridesToday}/{topTarget} rides
          </span>
        </div>
        <Progress value={Math.min(100, (ridesToday / topTarget) * 100)} className="h-2" />
        <p className="mt-2 text-sm text-secondary">
          {nextTier ? (
            <>
              Complete <b>{nextTier.rides_required - ridesToday}</b> more rides to unlock{" "}
              <b>₹{nextTier.bonus_amount}</b> bonus! 🚀
            </>
          ) : (
            <>You've hit the top milestone — bonus locked in! 🎉</>
          )}
        </p>

        <div className="mt-4 grid gap-2">
          {sortedTiers.map((t) => {
            const achieved = ridesToday >= t.rides_required;
            const pct = Math.min(100, (ridesToday / t.rides_required) * 100);
            return (
              <div
                key={t.rides_required}
                className={`rounded-md border p-3 ${achieved ? "border-success bg-success/5" : "border-border"}`}
              >
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className={`font-semibold ${achieved ? "text-success" : "text-secondary"}`}>
                    {achieved ? "🟢" : "⚪"} {t.label}: {t.rides_required} rides = ₹{t.bonus_amount}{" "}
                    Bonus
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {Math.min(ridesToday, t.rides_required)}/{t.rides_required}
                  </span>
                </div>
                <Progress value={pct} className="h-1.5" />
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
          <div>
            <p className="text-xs text-muted-foreground">Total Incentive Earned Today</p>
            <p className="font-display text-2xl text-secondary">₹{earnedToday.toFixed(2)}</p>
          </div>
          <p className="text-[11px] text-muted-foreground sm:text-right">
            Incentive money will be credited to your wallet at 12:00 AM midnight.
          </p>
        </div>
      </section>

      {activeJob && (
        <ActiveJobCard
          job={activeJob}
          onVerify={(otp, next, podPath) =>
            verifyOtp.mutate({
              id: activeJob.id,
              otp,
              next,
              podPath,
            })
          }
          onTimer={(patch) => setTimer.mutate({ id: activeJob.id, patch: patch as never })}
          pending={verifyOtp.isPending}
        />
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-wide text-secondary">Live requests</h2>
          <Badge className="bg-warning text-warning-foreground hover:bg-warning">
            {kycVerified ? pending.length : 0} waiting
          </Badge>
        </div>
        {!kycVerified ? (
          <div className="surface-card p-6 text-center text-sm text-muted-foreground">
            <ShieldCheck className="mx-auto mb-2 h-5 w-5 text-primary" />
            Ride requests unlock once your documents are verified by the MiniPort team.
          </div>
        ) : pending.length === 0 ? (
          <div className="surface-card p-6 text-center text-sm text-muted-foreground">
            <Truck className="mx-auto mb-2 h-5 w-5" />
            {isOnline ? "Looking for rides in Faridabad…" : "Go online to receive job requests."}
          </div>
        ) : (
          <div className="grid gap-3">
            {pending.map((b) => (
              <PendingJob
                key={b.id}
                job={b}
                onAccept={() => accept.mutate(b.id)}
                onDecline={() => decline.mutate(b.id)}
                pending={accept.isPending || decline.isPending}
              />
            ))}
          </div>
        )}
      </section>

      {incoming && (
        <IncomingRideOverlay
          job={incoming}
          accepting={accept.isPending}
          onAccept={() => {
            const id = incoming.id;
            setDismissed((d) => [...d, id]);
            accept.mutate(id);
          }}
          onDecline={() => {
            setDismissed((d) => [...d, incoming.id]);
            decline.mutate(incoming.id);
          }}
          onDismiss={() => setDismissed((d) => [...d, incoming.id])}
        />
      )}

      <section>
        <h2 className="mb-3 font-display text-2xl tracking-wide text-secondary">My jobs</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Jobs you accept will appear here.</p>
        ) : (
          <div className="grid gap-3">
            {mine.map((b) => {
              const meta = STATUS_META[b.status];
              const commission = Number(b.commission_amount || Math.round(Number(b.fare) * 0.1));
              const net = Number(b.driver_net_earning || Number(b.fare) - commission);
              return (
                <div key={b.id} className="surface-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {vehicleLabel(b.vehicle_type)} · {b.distance_km} km
                      </p>
                      <p className="truncate text-sm font-medium text-secondary">
                        {b.pickup_address}
                      </p>
                      <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                        <ArrowRight className="h-3 w-3" /> {b.drop_address}
                      </p>
                    </div>
                    <Badge className="bg-primary text-primary-foreground hover:bg-primary">
                      {meta.label}
                    </Badge>
                  </div>
                  {b.status === "completed" && (
                    <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs">
                      <div className="flex justify-between">
                        <span>Total Ride Fare</span>
                        <span>₹{Number(b.fare).toFixed(0)}</span>
                      </div>
                      <div className="flex justify-between text-destructive">
                        <span>
                          Miniport Commission ({Math.round(Number(b.commission_rate || 0.1) * 100)}
                          %)
                        </span>
                        <span>−₹{commission.toFixed(0)}</span>
                      </div>
                      <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold text-success">
                        <span>Your Net Earning</span>
                        <span>₹{net.toFixed(0)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <SupportChat role="driver" />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-card p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl text-secondary">{value}</p>
    </div>
  );
}

function PendingJob({
  job,
  onAccept,
  onDecline,
  pending,
}: {
  job: AnyRow;
  onAccept: () => void;
  onDecline: () => void;
  pending: boolean;
}) {
  const [secs, setSecs] = useState(30);
  useEffect(() => {
    if (secs <= 0) return;
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs]);
  const commission = Math.round(Number(job.fare) * 0.1);
  const net = Number(job.fare) - commission;
  return (
    <div className="surface-card border-l-4 border-l-primary p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {vehicleLabel(job.vehicle_type)} · {job.distance_km} km ·{" "}
            {job.payment_method === "cod" ? "CASH" : "ONLINE"}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-secondary">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Pickup: {job.pickup_address}
          </p>
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Drop: {job.drop_address}
          </p>
          {job.notes && <p className="mt-1 text-xs italic text-muted-foreground">"{job.notes}"</p>}
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase text-muted-foreground">You will earn</p>
          <p className="font-display text-2xl text-success">₹{net}</p>
          <p className="text-[10px] text-muted-foreground">
            Fare ₹{Number(job.fare).toFixed(0)} − 10%
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" onClick={onAccept} disabled={pending}>
          Accept Ride
        </Button>
        <Button size="sm" variant="outline" onClick={onDecline} disabled={pending}>
          Pass / Decline
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {secs > 0 ? `New request · ${secs}s alert timer` : "Still available · alert timer ended"}.
        Passing hides it for you only.
      </p>
    </div>
  );
}

function playRideAlert() {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    const context = new Ctor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Browsers may block audio until the driver has interacted with the page.
  }
}

function ActiveJobCard({
  job,
  onVerify,
  onTimer,
  pending,
}: {
  job: AnyRow;
  onVerify: (otp: string, next: "in_progress" | "completed", podPath?: string | null) => void;
  onTimer: (patch: Record<string, string>) => void;
  pending: boolean;
}) {
  const [otp, setOtp] = useState("");
  const [podPath, setPodPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadProof = async (file: File) => {
    setUploading(true);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setUploading(false);
      toast.error("Session expired — please sign in again");
      return;
    }
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${uid}/${job.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("delivery-proof")
      .upload(path, file, { upsert: true });
    setUploading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPodPath(path);
    toast.success("Proof photo attached");
  };
  const next = job.status === "accepted" ? "in_progress" : "completed";
  const label = next === "in_progress" ? "Verify Pickup OTP" : "Verify Drop OTP";
  const contact = extractContact(job.notes, next === "in_progress" ? "Sender" : "Receiver");
  const commission = Math.round(Number(job.fare) * 0.1);
  const net = Number(job.fare) - commission;
  const isCash = job.payment_method === "cod";
  // Navigate to the exact pin the customer dropped whenever we have it.
  const targetLat = next === "in_progress" ? job.pickup_lat : job.drop_lat;
  const targetLng = next === "in_progress" ? job.pickup_lng : job.drop_lng;
  const navUrl =
    typeof targetLat === "number" && typeof targetLng === "number"
      ? `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
          next === "in_progress" ? job.pickup_address : job.drop_address,
        )}&travelmode=driving`;
  return (
    <section className="surface-card border-l-4 border-l-primary p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">Active job</p>
      <p className="mt-1 text-sm font-medium text-secondary">Pickup: {job.pickup_address}</p>
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowRight className="h-3 w-3" /> Drop: {job.drop_address}
      </p>

      <div
        className={`mt-3 rounded-md px-3 py-2 text-sm ${isCash ? "bg-warning/15 text-warning-foreground" : "bg-success/15 text-success-foreground"}`}
      >
        <IndianRupee className="mr-1 inline h-3.5 w-3.5" />
        {isCash
          ? `Payment Mode: Cash — Collect ₹${Number(job.fare).toFixed(0)} from customer`
          : `Payment Mode: Online — ₹${net.toFixed(0)} will be added to your wallet`}
      </div>

      {job.status === "accepted" && job.loading_started_at && (
        <LoadingTimerCard
          vehicleType={job.vehicle_type}
          startedAt={job.loading_started_at}
          stoppedAt={job.loading_stopped_at}
          title="Loading time at pickup"
        />
      )}
      {job.status === "in_progress" && job.unloading_started_at && (
        <LoadingTimerCard
          vehicleType={job.vehicle_type}
          startedAt={job.unloading_started_at}
          stoppedAt={job.unloading_stopped_at}
          title="Unloading time at drop"
        />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          asChild
          size="sm"
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <a href={navUrl} target="_blank" rel="noopener noreferrer">
            <MapPin className="h-3.5 w-3.5" /> Open Google Maps Navigation
          </a>
        </Button>
        {contact.phone && (
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${contact.phone}`}>
              <Phone className="h-3.5 w-3.5" /> Call{" "}
              {contact.name || (next === "in_progress" ? "sender" : "receiver")}
            </a>
          </Button>
        )}
        {job.status === "accepted" && !job.loading_started_at && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onTimer({ loading_started_at: new Date().toISOString() })}
          >
            <Timer className="h-3.5 w-3.5" /> Arrived — start loading timer
          </Button>
        )}
        {job.status === "accepted" && job.loading_started_at && !job.loading_stopped_at && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onTimer({ loading_stopped_at: new Date().toISOString() })}
          >
            <Timer className="h-3.5 w-3.5" /> Stop loading timer
          </Button>
        )}
        {job.status === "in_progress" && !job.unloading_started_at && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onTimer({ unloading_started_at: new Date().toISOString() })}
          >
            <Timer className="h-3.5 w-3.5" /> Reached drop — start unloading timer
          </Button>
        )}
        {job.status === "in_progress" && job.unloading_started_at && !job.unloading_stopped_at && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onTimer({ unloading_stopped_at: new Date().toISOString() })}
          >
            <Timer className="h-3.5 w-3.5" /> Stop unloading timer
          </Button>
        )}
      </div>

      <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {next === "in_progress"
            ? "Ask the sender for the 4-digit pickup OTP to start the trip."
            : "Ask the receiver for the 4-digit drop OTP to complete the trip. A delivery photo is extra proof, not a substitute."}
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            inputMode="numeric"
            maxLength={4}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            placeholder="0000"
            className="max-w-[8rem] text-center tracking-widest"
          />
          <Button
            size="sm"
            // Proof of delivery is mandatory, so the photo must be added first.
            disabled={pending || otp.length !== 4 || (next === "completed" && !podPath)}
            onClick={() => {
              onVerify(otp, next, podPath);
              setOtp("");
            }}
          >
            {pending ? "Verifying…" : next === "in_progress" ? "Start trip" : "Complete trip"}
          </Button>
        </div>

        {next === "completed" && (
          <div className="mt-3 border-t border-primary/20 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Proof of delivery {!podPath && <span className="text-destructive">· required</span>}
            </p>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-secondary">
              <Camera className="h-4 w-4 text-primary" />
              {uploading
                ? "Uploading…"
                : podPath
                  ? "Photo attached — retake"
                  : "Take / upload delivery photo"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadProof(f);
                }}
              />
            </label>
            {podPath && (
              <p className="mt-1 text-xs text-success">
                Photo attached — it will be saved with the trip. The drop OTP is still required.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function extractContact(notes: string | null, prefix: "Sender" | "Receiver") {
  if (!notes) return { name: "", phone: "" };
  const re = new RegExp(`${prefix}:\\s*([^(]+)\\(([^)]*)\\)`);
  const m = notes.match(re);
  return { name: (m?.[1] ?? "").trim(), phone: (m?.[2] ?? "").trim() };
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-center py-10">{children}</div>;
}
