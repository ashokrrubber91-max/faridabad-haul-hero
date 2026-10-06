import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, MessageCircle, PhoneCall, ShieldCheck, Star, Truck, User } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuickChatModal } from "@/components/chat/QuickChatModal";
import { supabase } from "@/integrations/supabase/client";
import { vehicleLabel } from "@/lib/booking";

const ISSUE_TAGS = ["Demanded extra cash", "Rash driving", "Wrong Vehicle", "No issues"];

export function ActiveTripCard({
  bookingId,
  driverId,
  vehicleType,
  status,
}: {
  bookingId: string;
  driverId: string | null;
  vehicleType: string;
  status: "accepted" | "in_progress";
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);

  const contact = useQuery({
    queryKey: ["active-driver-contact", bookingId],
    enabled: !!driverId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("booking_contacts", { _booking_ids: [bookingId] });
      if (error) throw error;
      const row = (data ?? [])[0];
      return row ? { name: row.name as string, phone: row.phone as string | null } : null;
    },
  });

  const vehicle = useQuery({
    queryKey: ["active-driver-vehicle", driverId],
    enabled: !!driverId,
    queryFn: async () => {
      const { data } = await supabase
        .from("driver_kyc")
        .select("vehicle_number")
        .eq("driver_id", driverId!)
        .maybeSingle();
      return data?.vehicle_number ?? null;
    },
  });

  const codes = useQuery({
    queryKey: ["active-trip-pin", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_booking_otps", { _booking_id: bookingId });
      if (error) throw error;
      const row = (data ?? [])[0];
      return row?.pickup_otp ? String(row.pickup_otp) : null;
    },
    staleTime: 30_000,
  });

  const driverName = contact.data?.name ?? (contact.isLoading ? "Captain" : "Assigned driver");
  const pin = (codes.data ?? "").padStart(4, "0").slice(0, 4);

  const reportIssue = (tag: string) => {
    setIssue(tag);
    toast.success(tag === "No issues" ? "No issue recorded" : "Issue noted for this trip");
  };

  return (
    <>
      <div className="mt-3 rounded-xl border bg-background p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <User className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {status === "accepted" ? "Captain assigned" : "Trip in progress"}
            </p>
            <p className="mt-0.5 truncate text-base font-bold text-secondary">{driverName}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary"><ShieldCheck className="mr-1 h-3 w-3" />Verified driver</Badge>
              <Badge variant="outline"><Star className="mr-1 h-3 w-3 fill-current" />4.8</Badge>
              <Badge variant="outline">Speaks Hindi, English</Badge>
            </div>
          </div>
          <div className="flex gap-1.5">
            {contact.data?.phone && (
              <Button size="icon" variant="outline" asChild>
                <a href={"tel:" + contact.data.phone} aria-label="Call driver"><PhoneCall className="h-4 w-4" /></a>
              </Button>
            )}
            <Button size="icon" onClick={() => setChatOpen(true)} aria-label="Message driver">
              <MessageCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Vehicle</p>
            <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-secondary">
              <Truck className="h-4 w-4 text-primary" />{vehicleLabel(vehicleType)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Vehicle plate</p>
            <p className="mt-1 text-sm font-bold text-secondary">{vehicle.data ?? "Verifying…"}</p>
          </div>
        </div>

        {pin && (
          <div className="mt-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
            <p className="text-center text-xs font-semibold text-secondary">Start your order with PIN:</p>
            <div className="mt-2 flex justify-center gap-2">
              {pin.split("").map((digit, i) => (
                <span key={i} className="grid h-11 w-11 place-items-center rounded-lg border bg-background font-display text-2xl tracking-wider text-primary shadow-sm">
                  {digit}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold text-secondary">Report an issue</p>
          <div className="flex flex-wrap gap-2">
            {ISSUE_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => reportIssue(tag)}
                className={"rounded-full border px-3 py-1.5 text-xs transition-colors " + (issue === tag ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <Button className="mt-3 w-full" variant="outline" onClick={() => setChatOpen(true)}>
          <MessageCircle className="mr-2 h-4 w-4" /> Message {driverName}
        </Button>
        <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-success" /> Chat stays inside MiniPort
        </div>
      </div>

      <QuickChatModal open={chatOpen} onOpenChange={setChatOpen} bookingId={bookingId} driverName={driverName} />
    </>
  );
}
