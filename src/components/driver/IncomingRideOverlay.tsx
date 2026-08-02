import { useEffect, useRef, useState } from "react";
import { ArrowRight, MapPin, PhoneCall, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vehicleLabel } from "@/lib/booking";

type Job = {
  id: string;
  pickup_address: string;
  drop_address: string;
  vehicle_type: string;
  distance_km: number | string;
  fare: number | string;
  payment_method: string;
  notes: string | null;
};

/** Loops a short two-tone "ring" via WebAudio until stopped. */
function useRingtone(active: boolean, muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || muted) return;
    let cancelled = false;

    const start = () => {
      if (cancelled) return;
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = ctxRef.current ?? new Ctor();
      ctxRef.current = ctx;
      void ctx.resume();

      const ring = () => {
        if (cancelled || ctx.state === "closed") return;
        [0, 0.28].forEach((offset, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = i === 0 ? 880 : 660;
          gain.gain.value = 0.0001;
          osc.connect(gain).connect(ctx.destination);
          const t = ctx.currentTime + offset;
          gain.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
          osc.start(t);
          osc.stop(t + 0.26);
        });
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.([250, 120, 250]);
        }
      };

      ring();
      timerRef.current = setInterval(ring, 1600);
    };

    start();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(0);
    };
  }, [active, muted]);
}

export function IncomingRideOverlay({
  job,
  onAccept,
  onDismiss,
  accepting,
}: {
  job: Job;
  onAccept: () => void;
  onDismiss: () => void;
  accepting: boolean;
}) {
  const [secs, setSecs] = useState(30);
  const [muted, setMuted] = useState(false);
  useRingtone(secs > 0, muted);

  useEffect(() => {
    setSecs(30);
  }, [job.id]);

  useEffect(() => {
    if (secs <= 0) {
      onDismiss();
      return;
    }
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secs]);

  const commission = Math.round(Number(job.fare) * 0.1);
  const net = Number(job.fare) - commission;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Incoming ride request"
      className="fixed inset-0 z-50 flex flex-col bg-secondary/95 p-5 text-white backdrop-blur-sm"
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-widest">
          <PhoneCall className="h-3.5 w-3.5 animate-pulse" /> Incoming ride
        </span>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute alert" : "Mute alert"}
          className="rounded-full bg-white/10 p-2"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-auto">
        <p className="font-display text-6xl leading-none">{secs}s</p>
        <p className="mt-1 text-xs uppercase tracking-widest text-white/60">
          {vehicleLabel(job.vehicle_type)} · {job.distance_km} km · {job.payment_method === "cod" ? "Cash" : "Online"}
        </p>

        <div className="mt-5 space-y-2">
          <p className="flex items-start gap-2 text-base font-semibold">
            <MapPin className="mt-1 h-4 w-4 shrink-0 text-primary" />
            {job.pickup_address}
          </p>
          <p className="flex items-start gap-2 text-base text-white/80">
            <ArrowRight className="mt-1 h-4 w-4 shrink-0" />
            {job.drop_address}
          </p>
          {job.notes && <p className="text-sm italic text-white/60">&ldquo;{job.notes}&rdquo;</p>}
        </div>

        <div className="mt-6 rounded-lg bg-white/10 p-4">
          <p className="text-[11px] uppercase tracking-widest text-white/60">You will earn</p>
          <p className="font-display text-4xl">₹{net}</p>
          <p className="text-[11px] text-white/50">Fare ₹{Number(job.fare).toFixed(0)} − 10% commission</p>
        </div>
      </div>

      <div className="mt-auto grid gap-2 pt-6">
        <Button className="h-14 w-full text-lg" onClick={onAccept} disabled={accepting || secs <= 0}>
          {accepting ? "Accepting…" : "Accept ride"}
        </Button>
        <Button variant="outline" className="h-11 w-full border-white/30 bg-transparent text-white hover:bg-white/10" onClick={onDismiss}>
          Decline
        </Button>
      </div>
    </div>
  );
}
