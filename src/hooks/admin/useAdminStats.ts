import { useMemo } from "react";
import { useAdminBookings } from "./useAdminBookings";
import { useAdminProfiles } from "./useAdminProfiles";

export function useAdminStats() {
  const bookings = useAdminBookings();
  const profiles = useAdminProfiles();
  const stats = useMemo(() => {
    const all = bookings.data ?? [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayBookings = all.filter((b) => new Date(b.created_at) >= today);
    const completedToday = todayBookings.filter((b) => b.status === "completed");
    const completedAll = all.filter((b) => b.status === "completed");
    return {
      todayBookings,
      completedToday,
      completedAll,
      pending: all.filter((b) => b.status === "pending").length,
      active: all.filter((b) => b.status === "accepted" || b.status === "in_progress"),
      revenueToday: completedToday.reduce((s, b) => s + Number(b.fare), 0),
      revenueAll: completedAll.reduce((s, b) => s + Number(b.fare), 0),
      commissionAll: completedAll.reduce((s, b) => s + Number(b.commission_amount ?? 0), 0),
      drivers: (profiles.data ?? []).filter((p) => p.active_mode === "driver"),
      onlineDrivers: (profiles.data ?? []).filter((p) => p.active_mode === "driver" && p.is_online).length,
    };
  }, [bookings.data, profiles.data]);
  return { ...stats, bookings, profiles };
}
