import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export function CustomerDeliveryCodes({
  bookingId,
  status,
  multiStop,
}: {
  bookingId: string;
  status: string;
  multiStop: boolean;
}) {
  const { user } = useAuth();
  const enabled = !!user && ["accepted", "in_progress"].includes(status);
  const codes = useQuery({
    queryKey: ["customer-delivery-codes", user?.id, bookingId, status],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_booking_otps", { _booking_id: bookingId });
      if (error) throw error;
      return data?.[0]?.drop_otp ?? null;
    },
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false,
  });
  const stops = useQuery({
    queryKey: ["customer-stop-codes", user?.id, bookingId, status],
    enabled: enabled && multiStop,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_booking_stop_otps", {
        _booking_id: bookingId,
      });
      if (error) throw error;
      return (data ?? []) as Array<{ sequence: number; otp: string; verified_at: string | null }>;
    },
    staleTime: 10_000,
    refetchInterval: enabled && multiStop ? 15_000 : false,
  });
  if (!enabled) return null;
  return (
    <div className="mt-3 space-y-3" aria-live="polite">
      {codes.isPending && <p className="text-xs text-muted-foreground">Loading delivery code…</p>}
      {codes.isError && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <p>Couldn’t load the delivery code.</p>
          <Button size="sm" variant="outline" onClick={() => void codes.refetch()}>
            Retry delivery code
          </Button>
        </div>
      )}
      {codes.data && (
        <div className="rounded-md border bg-primary/5 p-3">
          <p className="text-xs font-semibold">Delivery OTP</p>
          <p className="mt-1 font-mono text-2xl font-bold text-primary">{codes.data}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Share with the receiver. Give it to the driver only after delivery.
          </p>
        </div>
      )}
      {multiStop && stops.isPending && (
        <p className="text-xs text-muted-foreground">Loading extra-stop codes…</p>
      )}
      {multiStop && stops.isError && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <p>Couldn’t load extra-stop codes.</p>
          <Button size="sm" variant="outline" onClick={() => void stops.refetch()}>
            Retry stop codes
          </Button>
        </div>
      )}
      {multiStop && !!stops.data?.length && (
        <div className="rounded-md border bg-primary/5 p-3">
          <p className="text-xs font-semibold">Extra stop verification codes</p>
          <div className="mt-2 space-y-2">
            {stops.data.map((stop) => (
              <div key={stop.sequence} className="flex items-center justify-between gap-3 text-sm">
                <span>Stop {stop.sequence}</span>
                <span className="font-mono font-bold text-primary">
                  {stop.verified_at ? "Verified" : stop.otp}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Give each code to the receiver at that stop.
          </p>
        </div>
      )}
    </div>
  );
}
