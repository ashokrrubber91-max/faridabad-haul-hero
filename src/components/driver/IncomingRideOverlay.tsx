import { useEffect, useRef, useState } from "react";
import { ArrowRight, MapPin, PhoneCall, Volume2, VolumeX, Mic, CalendarClock, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { vehicleLabel } from "@/lib/booking";

type Job = {
  id: string; pickup_address: string; drop_address: string; vehicle_type: string;
  distance_km: number | string; fare: number | string; payment_method: string;
  notes: string | null; scheduled_for?: string | null; cargo_weight_kg?: number | string | null;
};
type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void;
  onresult: ((event: { results?: { [index: number]: { [index: number]: { transcript?: string } } } }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
};
function formatScheduledTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}
function speakBriefing(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "hi-IN"; utterance.pitch = 1.12; utterance.rate = 0.94;
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => /hi-IN/i.test(v.lang) && /female|woman|google/i.test(v.name)) ?? voices.find(v => /hi-IN/i.test(v.lang));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}
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
      const ctx = ctxRef.current ?? new Ctor(); ctxRef.current = ctx; void ctx.resume();
      const ring = () => {
        if (cancelled || ctx.state === "closed") return;
        [0, 0.28].forEach((offset, i) => {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.type = "sine"; osc.frequency.value = i === 0 ? 880 : 660; gain.gain.value = 0.0001;
          osc.connect(gain).connect(ctx.destination); const t = ctx.currentTime + offset;
          gain.gain.exponentialRampToValueAtTime(0.22, t + 0.03); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
          osc.start(t); osc.stop(t + 0.26);
        });
        if ("vibrate" in navigator) navigator.vibrate?.([250, 120, 250]);
      };
      ring(); timerRef.current = setInterval(ring, 1600);
    };
    start();
    return () => { cancelled = true; if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; if ("vibrate" in navigator) navigator.vibrate?.(0); };
  }, [active, muted]);
}
export function IncomingRideOverlay({ job, onAccept, onDecline, onDismiss, accepting }: {
  job: Job; onAccept: () => void; onDecline: () => void; onDismiss: () => void; accepting: boolean;
}) {
  const [secs, setSecs] = useState(30);
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const briefingSpokenFor = useRef<string | null>(null);
  useRingtone(secs > 0, muted);
  useEffect(() => {
    setSecs(30); setListening(false);
    if (briefingSpokenFor.current !== job.id) {
      briefingSpokenFor.current = job.id;
      const fare = Number(job.fare) || 0; const commission = Math.round(fare * 0.1); const net = fare - commission;
      const weight = job.cargo_weight_kg != null && Number(job.cargo_weight_kg) > 0 ? `Cargo weight ${Number(job.cargo_weight_kg)} kilogram. ` : "";
      const schedule = job.scheduled_for ? `Pickup scheduled for ${formatScheduledTime(job.scheduled_for)}. ` : "";
      const briefing = `Bhai, ${schedule}${job.pickup_address} se ${vehicleLabel(job.vehicle_type)}, ${job.distance_km} kilometer ki booking aayi hai. ${weight}Drop ${job.drop_address}. Total fare ${fare} rupaye hai, platform commission lagbhag ${commission} rupaye aur aapki estimated earning ${net} rupaye hogi. Kya aap ride accept karna chahenge ya reject?`;
      if (!muted) window.setTimeout(() => speakBriefing(briefing), 350);
    }
    return () => window.speechSynthesis?.cancel();
  }, [job.id, job.pickup_address, job.drop_address, job.vehicle_type, job.distance_km, job.fare, job.scheduled_for, job.cargo_weight_kg, muted]);
  useEffect(() => { if (secs <= 0) return; const t = setTimeout(() => setSecs(s => s - 1), 1000); return () => clearTimeout(t); }, [secs]);
  const startVoiceCommand = () => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) { toast.error("Voice commands are not supported in this browser. Please tap Accept or Reject."); return; }
    const rec = new Ctor(); rec.lang = "hi-IN"; rec.continuous = false; rec.interimResults = false;
    rec.onresult = event => {
      const words = event.results?.[0]?.[0]?.transcript?.toLowerCase() ?? ""; setListening(false);
      if (/accept|haan|han|kar do|le lo|स्वीकार|हाँ/.test(words)) { speakBriefing("Theek hai bhai, ride accept kar rahe hain."); onAccept(); }
      else if (/reject|decline|nahi|nahin|mat lo|छोड़|नहीं/.test(words)) { speakBriefing("Theek hai bhai, ride reject kar rahe hain."); onDecline(); }
      else toast.info("Please say Accept ya Reject, or tap a button.");
    };
    rec.onerror = () => { setListening(false); toast.error("Voice clear nahi aayi. Dobara try karein."); };
    rec.onend = () => setListening(false); recognitionRef.current = rec; setListening(true);
    try { rec.start(); } catch { setListening(false); toast.error("Microphone start nahi hua. Button se choose karein."); }
  };
  const commission = Math.round(Number(job.fare) * 0.1); const net = Number(job.fare) - commission;
  const weight = job.cargo_weight_kg != null && Number(job.cargo_weight_kg) > 0 ? Number(job.cargo_weight_kg) : null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Incoming ride request" className="fixed inset-0 z-50 flex flex-col bg-secondary/95 p-5 text-white backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-widest"><PhoneCall className="h-3.5 w-3.5 animate-pulse" /> Incoming ride</span>
        <button type="button" onClick={() => { setMuted(m => !m); if (!muted) window.speechSynthesis?.cancel(); }} aria-label={muted ? "Unmute alert" : "Mute alert"} className="rounded-full bg-white/10 p-2">{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
      </div>
      <div className="mt-auto">
        <p className="font-display text-6xl leading-none">{secs}s</p>
        <p className="mt-1 text-xs uppercase tracking-widest text-white/60">{vehicleLabel(job.vehicle_type)} · {job.distance_km} km · {job.payment_method === "cod" ? "Cash" : "Online"}</p>
        {job.scheduled_for && <Badge className="mt-3 inline-flex items-center gap-1 bg-primary text-primary-foreground"><CalendarClock className="h-3.5 w-3.5" /> Scheduled for {formatScheduledTime(job.scheduled_for)}</Badge>}
        <div className="mt-5 space-y-2">
          <p className="flex items-start gap-2 text-base font-semibold"><MapPin className="mt-1 h-4 w-4 shrink-0 text-primary" />{job.pickup_address}</p>
          <p className="flex items-start gap-2 text-base text-white/80"><ArrowRight className="mt-1 h-4 w-4 shrink-0" />{job.drop_address}</p>
          {weight !== null && <p className="flex items-center gap-2 text-sm font-semibold text-white"><Package className="h-4 w-4 text-primary" /> Cargo weight: {weight} kg</p>}
          {job.notes && <p className="text-sm italic text-white/60">&ldquo;{job.notes}&rdquo;</p>}
        </div>
        <div className="mt-6 rounded-lg bg-white/10 p-4"><p className="text-[11px] uppercase tracking-widest text-white/60">Estimated net earning</p><p className="font-display text-4xl">₹{net}</p><p className="text-[11px] text-white/50">Fare ₹{Number(job.fare).toFixed(0)} − estimated 10% commission (₹{commission})</p></div>
      </div>
      <div className="mt-auto grid gap-2 pt-6">
        <Button className="h-14 w-full text-lg" onClick={onAccept} disabled={accepting}>{accepting ? "Accepting…" : "Accept ride"}</Button>
        <Button variant="outline" className="h-11 w-full border-white/30 bg-transparent text-white hover:bg-white/10" onClick={onDecline}>Reject ride</Button>
        <Button variant="secondary" className="h-11 w-full" onClick={startVoiceCommand} disabled={listening}><Mic className="mr-2 h-4 w-4" />{listening ? "Listening… say Accept or Reject" : "Say “Accept” or “Reject”"}</Button>
        <Button variant="ghost" className="h-9 w-full text-white/70 hover:bg-white/10 hover:text-white" onClick={onDismiss}>Keep in live requests</Button>
      </div>
    </div>
  );
}
