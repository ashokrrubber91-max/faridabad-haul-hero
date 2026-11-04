import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { PlacePick } from "@/components/booking/LocationSearchOverlay";
import { getPlaceDetails, searchPlaces } from "@/lib/geocode.functions";
import { useVoiceInput, useVoiceOutput } from "@/hooks/useVoiceChat";
import {
  parseRideCommand,
  serviceAreaQuery,
  vehicleForWeight,
  type ParsedRideCommand,
} from "@/lib/voice-booking";
import type { VehicleType } from "@/lib/vehicles";

export type VoiceRide = {
  pickup: PlacePick;
  drop: PlacePick;
  vehicle: string;
  weightKg: number | null;
};

type Phase = "idle" | "listening" | "resolving" | "quoting" | "countdown" | "booking" | "error";

const COUNTDOWN_SECONDS = 5;
const QUOTE_TIMEOUT_MS = 20_000;
const EXAMPLE = "“Sector 15 se NIT tak, 600 kilo, Tata Ace”";

async function resolvePlace(spoken: string): Promise<PlacePick | null> {
  const sessionToken = crypto.randomUUID();
  const { suggestions } = await searchPlaces({
    data: { input: serviceAreaQuery(spoken).slice(0, 200), sessionToken },
  });
  const first = suggestions[0];
  if (!first) return null;
  const { place } = await getPlaceDetails({ data: { placeId: first.placeId, sessionToken } });
  if (!place) return null;
  return { address: place.address, lat: place.lat, lng: place.lng, placeId: first.placeId };
}

/**
 * Floating voice assistant: listens, parses the ride on-device, resolves real
 * addresses, fills the booking and — after a cancellable countdown — places it
 * through the normal server-priced booking flow (same dispatch as a tap).
 */
export function VoiceBookingAssistant({
  vehicles,
  currentVehicle,
  quoteReady,
  quoteFailed,
  fareLabel,
  submitting,
  onApply,
  onConfirm,
}: {
  vehicles: VehicleType[];
  currentVehicle: string;
  quoteReady: boolean;
  quoteFailed: boolean;
  fareLabel: string | null;
  submitting: boolean;
  onApply: (ride: VoiceRide) => void;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [parsed, setParsed] = useState<ParsedRideCommand | null>(null);
  const [message, setMessage] = useState("Tap the mic and say your ride.");
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS);
  const [summary, setSummary] = useState("");
  const voiceOut = useVoiceOutput();
  const { speak } = voiceOut;
  const runId = useRef(0);

  const say = useCallback((text: string) => speak(text, "en-IN"), [speak]);

  const fail = useCallback(
    (text: string) => {
      setPhase("error");
      setMessage(text);
      say(text);
    },
    [say],
  );

  const handleTranscript = useCallback(
    async (text: string) => {
      const id = ++runId.current;
      setTranscript(text);
      const command = parseRideCommand(text);
      setParsed(command);
      if (!command.pickup || !command.drop) {
        fail(`I need both pickup and drop. Try saying ${EXAMPLE}.`);
        return;
      }
      const vehicleId =
        command.vehicle ??
        (command.weightKg ? vehicleForWeight(command.weightKg, vehicles) : null) ??
        currentVehicle;
      const vehicle = vehicles.find((v) => v.id === vehicleId);
      if (!vehicle) {
        fail("That vehicle is not available right now. Please choose another one.");
        return;
      }
      const capacity = Number(vehicle.payload_kg ?? vehicle.weight_limit_kg ?? 0);
      if (command.weightKg && capacity > 0 && command.weightKg > capacity) {
        fail(
          `${command.weightKg} kilo is more than a ${vehicle.label} can carry (${capacity} kilo). Please say a bigger vehicle.`,
        );
        return;
      }
      setPhase("resolving");
      setMessage("Finding the exact addresses…");
      try {
        const [pickup, drop] = await Promise.all([
          resolvePlace(command.pickup),
          resolvePlace(command.drop),
        ]);
        if (id !== runId.current) return;
        if (!pickup || !drop) {
          fail(
            `I couldn't find ${!pickup ? command.pickup : command.drop} in Faridabad. Please say a nearby landmark.`,
          );
          return;
        }
        setSummary(
          `${vehicle.label} from ${pickup.address.split(",")[0]} to ${drop.address.split(",")[0]}` +
            (command.weightKg ? `, ${command.weightKg} kilo` : ""),
        );
        setPhase("quoting");
        setMessage("Measuring the road route and fare…");
        onApply({ pickup, drop, vehicle: vehicle.id, weightKg: command.weightKg });
      } catch {
        if (id === runId.current)
          fail("Address search is unavailable right now. Please try again.");
      }
    },
    [currentVehicle, fail, onApply, vehicles],
  );

  const onVoiceResult = useCallback(
    (text: string) => void handleTranscript(text),
    [handleTranscript],
  );
  const voiceIn = useVoiceInput(onVoiceResult, "en-IN");

  // Listening ends without a result → back to idle instead of a stuck spinner.
  useEffect(() => {
    if (phase === "listening" && !voiceIn.listening && !transcript) {
      setPhase("idle");
      setMessage("I didn't catch that. Tap the mic and try again.");
    }
  }, [phase, voiceIn.listening, transcript]);

  // Route & fare are ready → spoken summary + cancellable countdown.
  useEffect(() => {
    if (phase !== "quoting") return;
    if (quoteFailed) {
      fail("We couldn't measure this route. Please check the addresses and try again.");
      return;
    }
    if (quoteReady) {
      setSeconds(COUNTDOWN_SECONDS);
      setPhase("countdown");
      const line = `${summary}${fareLabel ? `, about ${fareLabel}` : ""}. Booking in ${COUNTDOWN_SECONDS} seconds. Tap cancel to stop.`;
      setMessage(line);
      say(line);
      return;
    }
    const timer = setTimeout(
      () => fail("The route is taking too long. Please try again."),
      QUOTE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [phase, quoteReady, quoteFailed, summary, fareLabel, fail, say]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (seconds <= 0) {
      setPhase("booking");
      setMessage("Placing your booking and alerting nearby drivers…");
      onConfirm();
      return;
    }
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, seconds, onConfirm]);

  // Booking attempt finished. Success navigates to the live search screen;
  // a failure is already shown by the booking flow, so just release the sheet.
  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (phase !== "booking") return;
    if (submitting) wasSubmitting.current = true;
    else if (wasSubmitting.current) {
      wasSubmitting.current = false;
      setPhase("idle");
      setMessage("Tap the mic to try again, or finish on the review screen.");
    }
  }, [phase, submitting]);

  const startListening = () => {
    if (!voiceIn.supported) {
      fail("Voice input isn't supported in this browser. Please use Chrome on Android.");
      return;
    }
    runId.current++;
    voiceOut.stop();
    setTranscript("");
    setParsed(null);
    setPhase("listening");
    setMessage(`Listening… say ${EXAMPLE}`);
    voiceIn.start();
  };

  const cancel = () => {
    runId.current++;
    voiceIn.stop();
    voiceOut.stop();
    setPhase("idle");
    setMessage("Cancelled. Your details stay filled in — review and book when ready.");
  };

  const busy = phase === "resolving" || phase === "quoting" || phase === "booking";
  const listening = phase === "listening" && voiceIn.listening;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (phase === "idle" || phase === "error") startListening();
        }}
        aria-label="Book a ride by voice"
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] left-3 z-30 grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl ring-4 ring-primary/25 transition-transform hover:scale-105 sm:bottom-5 sm:left-5"
      >
        {phase !== "idle" && phase !== "error" && (
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" aria-hidden />
        )}
        <Mic className="relative h-7 w-7" />
      </button>

      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next && (phase === "countdown" || phase === "listening")) cancel();
          setOpen(next);
        }}
      >
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center justify-between gap-2">
              Voice booking
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => voiceOut.setMuted(!voiceOut.muted)}
                aria-label={voiceOut.muted ? "Unmute assistant voice" : "Mute assistant voice"}
              >
                {voiceOut.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
            </SheetTitle>
            <SheetDescription aria-live="polite">{message}</SheetDescription>
          </SheetHeader>

          {transcript && (
            <p className="mt-3 rounded-lg bg-muted/50 p-3 text-sm italic text-muted-foreground">
              “{transcript}”
            </p>
          )}

          {parsed && (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              {(
                [
                  ["Pickup", parsed.pickup],
                  ["Drop", parsed.drop],
                  ["Weight", parsed.weightKg ? `${parsed.weightKg} kg` : null],
                  [
                    "Vehicle",
                    vehicles.find((v) => v.id === parsed.vehicle)?.label ?? "Auto by weight",
                  ],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border p-2">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="truncate font-semibold text-secondary">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          )}

          {phase === "countdown" && (
            <p
              className="mt-4 text-center font-display text-5xl text-primary"
              aria-live="assertive"
            >
              {seconds}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            {phase === "countdown" || busy ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={cancel}
                  disabled={phase === "booking"}
                >
                  <X className="h-4 w-4" /> Cancel
                </Button>
                {phase === "countdown" ? (
                  <Button type="button" className="flex-1" onClick={() => setSeconds(0)}>
                    Book now
                  </Button>
                ) : (
                  <Button type="button" className="flex-1" disabled>
                    <Loader2 className="h-4 w-4 animate-spin" /> Working…
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="button"
                className="h-12 flex-1"
                onClick={listening ? cancel : startListening}
              >
                {listening ? (
                  <>
                    <MicOff className="h-4 w-4" /> Stop listening
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" /> Speak your ride
                  </>
                )}
              </Button>
            )}
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Fare is confirmed by MiniPort before booking.
          </p>
        </SheetContent>
      </Sheet>
    </>
  );
}
