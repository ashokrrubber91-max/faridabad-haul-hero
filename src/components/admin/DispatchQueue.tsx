import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminBookings } from "@/hooks/admin/useAdminBookings";
import { vehicleLabel } from "@/lib/booking";

export function DispatchQueue() {
  const { data, isLoading, isError, refetch } = useAdminBookings();
  const active = (data ?? []).filter((b) => b.status === "pending" || b.status === "accepted" || b.status === "in_progress");

  if (isLoading) return <div className="space-y-3">{[1,2,3].map((i)=><div key={i} className="surface-card p-4 space-y-3"><Skeleton className="h-4 w-40"/><Skeleton className="h-4 w-2/3"/><Skeleton className="h-8 w-24"/></div>)}</div>;
  if (isError) return <div className="surface-card p-6 text-center text-sm"><p className="text-muted-foreground">Could not load dispatch queue.</p><button className="mt-3 underline" onClick={()=>refetch()}>Retry</button></div>;
  return <section className="surface-card"><div className="border-b border-border px-4 py-3"><h3 className="font-display text-xl tracking-wide text-secondary">Live dispatch</h3><p className="text-xs text-muted-foreground">Active requests and assigned trips.</p></div><div className="divide-y divide-border">{active.length===0?<p className="p-6 text-center text-sm text-muted-foreground">No active dispatches.</p>:active.map(b=><div key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="text-sm font-medium text-secondary">{vehicleLabel(b.vehicle_type)} · {b.distance_km} km</p><p className="text-xs text-muted-foreground">{b.pickup_address} → {b.drop_address}</p></div><div className="flex items-center gap-2"><Badge>{b.status}</Badge><span className="font-semibold">₹{Number(b.fare).toFixed(0)}</span></div></div>)}</div></section>;
}
