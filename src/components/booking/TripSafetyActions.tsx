import { PhoneCall, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function TripSafetyActions({ bookingId, pickupAddress, dropAddress, phase, eta }: { bookingId: string; pickupAddress: string; dropAddress: string; phase: "accepted" | "in_progress"; eta: number | null }) {
  const shareText = `MiniPort live trip ${bookingId.slice(0, 8).toUpperCase()}\nPickup: ${pickupAddress}\nDrop: ${dropAddress}${eta ? `\nETA: ~${eta} min` : ""}\nStatus: ${phase === "accepted" ? "Driver coming to pickup" : "Trip in progress"}`;
  const shareUrl = `${window.location.origin}/customer?trip=${encodeURIComponent(bookingId)}`;
  const share = async () => { try { if (navigator.share) await navigator.share({ title: "MiniPort live trip", text: shareText, url: shareUrl }); else { await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`); toast.success("Trip details copied"); } } catch (error) { if ((error as DOMException)?.name !== "AbortError") toast.error("Could not share trip details"); } };
  const whatsapp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`, "_blank", "noopener,noreferrer"); };
  return <div className="flex flex-wrap gap-2 border-t bg-background px-3 py-2"><Button size="sm" variant="outline" asChild><a href="tel:112"><PhoneCall className="h-3.5 w-3.5" /> Emergency 112</a></Button><Button size="sm" variant="outline" onClick={() => void share()}><Share2 className="h-3.5 w-3.5" /> Share trip</Button><Button size="sm" variant="outline" onClick={whatsapp}>WhatsApp</Button></div>;
}
