import type { SupabaseClient as UntypedClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

const BOOSTS = [5, 25, 35, 45];

export function DriverMatchingCard({
  bookingId,
  vehicleType,
  currentFare = 0,
  paymentStatus = "pending",
  attempted = 0,
  total = 5,
  elapsedSeconds = 0,
  alternatives = ["Pickup 8ft", "Tata 407"],
  onBoost,
  onAlternative,
}: {
  bookingId: string;
  vehicleType: string;
  currentFare?: number;
  paymentStatus?: string;
  attempted?: number;
  total?: number;
  elapsedSeconds?: number;
  alternatives?: string[];
  onBoost?: (amount: number, newFare: number) => void;
  onAlternative?: (vehicle: string) => void;
}) {
  const [boost, setBoost] = useState(0);
  const [fare, setFare] = useState(currentFare);
  const [elapsed, setElapsed] = useState(elapsedSeconds);
  const [alternativeOpen, setAlternativeOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => setFare(currentFare), [currentFare]);
  useEffect(() => {
    const id = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (elapsed >= 60 && !autoOpened && alternatives.length > 0) {
      setAutoOpened(true);
      setAlternativeOpen(true);
    }
  }, [elapsed, autoOpened, alternatives.length]);

  const stats = useQuery({
    queryKey: ["driver-search-stats", bookingId],
    enabled: !!bookingId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_booking_driver_search_stats",
        {
          _booking_id: bookingId,
        },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        total: Number(row?.total_nearby ?? total),
        declined: Number(row?.declined_captains ?? attempted),
      };
    },
    refetchInterval: 5000,
    staleTime: 2000,
  });

  const nearbyTotal = stats.data?.total ?? total;
  const declined = stats.data?.declined ?? attempted;
  const progress = nearbyTotal > 0 ? Math.min(100, Math.round((declined / nearbyTotal) * 100)) : 0;
  const canBoost = paymentStatus === "pending";

  const chooseBoost = async (amount: number) => {
    if (!canBoost) {
      toast.error("Fare boost is locked after payment is completed.");
      return;
    }
    try {
      const { data, error } = await supabase.rpc(
        "set_booking_fare_boost",
        {
          _booking_id: bookingId,
          _boost: amount,
        },
      );
      if (error) throw error;
      const updated = Array.isArray(data) ? data[0] : data;
      const newFare = Number(updated?.fare ?? fare);
      setBoost(amount);
      setFare(newFare);
      onBoost?.(amount, newFare);
      toast.success(amount > 0 ? `Fare increased by ₹${amount}` : "Fare boost removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update fare boost");
    }
  };

  return (
    <>
      <div className="mt-3 rounded-xl border bg-background p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-secondary">Finding a captain for {vehicleType}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {declined} of {nearbyTotal} captains didn't accept your ride
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Current fare: ₹{fare.toFixed(0)}
            </p>
          </div>
          <Badge variant="outline">{progress}% search</Badge>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: progress + "%" }}
          />
        </div>
        <div className="mt-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-secondary">
            <TrendingUp className="h-4 w-4 text-primary" /> Boost fare to get accepted faster
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {BOOSTS.map((amount) => (
              <Button
                key={amount}
                type="button"
                size="sm"
                variant={boost === amount ? "default" : "outline"}
                onClick={() => void chooseBoost(amount)}
                disabled={!canBoost}
              >
                +₹{amount}
              </Button>
            ))}
          </div>
          {!canBoost ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Boost can only be changed before payment is completed.
            </p>
          ) : boost > 0 ? (
            <p className="mt-2 text-[11px] text-success">
              ₹{boost} boost selected · total fare ₹{fare.toFixed(0)}.
            </p>
          ) : null}
        </div>
        <div className="mt-4 text-[11px] text-muted-foreground">
          {elapsed < 60
            ? `Searching for more captains… ${60 - elapsed}s`
            : "No captain accepted within 60 seconds."}
        </div>
      </div>
      <Dialog open={alternativeOpen} onOpenChange={setAlternativeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Try another vehicle?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            No captain accepted this ride within 60 seconds. Choose another nearby vehicle category.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {alternatives.map((vehicle) => (
              <Button
                key={vehicle}
                type="button"
                variant="outline"
                onClick={() => {
                  setAlternativeOpen(false);
                  onAlternative?.(vehicle);
                }}
              >
                <Plus className="mr-1 h-3 w-3" /> {vehicle}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
