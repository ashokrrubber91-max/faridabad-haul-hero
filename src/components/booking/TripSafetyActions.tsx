import { useState } from "react";
import { PhoneCall, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/**
 * Safety row for an active trip: India emergency 112, plus a share link that
 * opens for someone who is not signed in. The link is a database-issued token
 * (expires in 24 hours, revocable) and the shared page shows status only — never
 * phone numbers, pickup/drop codes or fare details.
 */
export function TripSafetyActions({
  bookingId,
  pickupAddress,
  dropAddress,
  phase,
  eta,
}: {
  bookingId: string;
  pickupAddress: string;
  dropAddress: string;
  phase: "accepted" | "in_progress";
  eta: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const shareText = `MiniPort live trip ${bookingId.slice(0, 8).toUpperCase()}\nPickup: ${pickupAddress}\nDrop: ${dropAddress}${eta ? `\nETA: ~${eta} min` : ""}\nStatus: ${phase === "accepted" ? "Driver coming to pickup" : "Trip in progress"}`;

  const buildLink = async (): Promise<string | null> => {
    const { data, error } = await supabase.rpc("create_booking_share_link", {
      _booking_id: bookingId,
    });
    if (error || !data) {
      toast.error(error?.message ?? "Could not create a share link");
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const token = (row as { token?: string })?.token;
    if (!token) {
      toast.error("Could not create a share link");
      return null;
    }
    return `${window.location.origin}/trip/${token}`;
  };

  const share = async () => {
    setBusy(true);
    const url = await buildLink();
    setBusy(false);
    if (!url) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "MiniPort live trip", text: shareText, url });
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${url}`);
        toast.success("Live trip link copied — valid for 24 hours");
      }
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError")
        toast.error("Could not share trip details");
    }
  };

  const whatsapp = async () => {
    setBusy(true);
    const url = await buildLink();
    setBusy(false);
    if (!url) return;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div className="flex flex-wrap gap-2 border-t bg-background px-3 py-2">
      <Button size="sm" variant="outline" asChild>
        <a href="tel:112">
          <PhoneCall className="h-3.5 w-3.5" /> Emergency 112
        </a>
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void share()}>
        <Share2 className="h-3.5 w-3.5" /> {busy ? "Preparing…" : "Share trip"}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void whatsapp()}>
        WhatsApp
      </Button>
    </div>
  );
}
