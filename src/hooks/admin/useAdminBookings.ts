import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BOOKING_FIELDS } from "@/lib/booking";
import type { Tables } from "@/integrations/supabase/types";

export type AdminBooking = Tables<"bookings">;

export function useAdminBookings() {
  return useQuery({
    queryKey: ["admin-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings").select(BOOKING_FIELDS).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as AdminBooking[];
    },
    staleTime: 10_000,
  });
}
