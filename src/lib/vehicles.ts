import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { registerVehicleLabels } from "@/lib/booking";

/**
 * The vehicle catalogue lives in the database so the team can add, price and
 * retire vehicles without a code change. Pricing shown here is only a preview:
 * the payable fare is always recomputed on the server from the same rows.
 */
export type VehicleType = {
  id: string;
  label: string;
  capacity_label: string;
  weight_limit_kg: number | null;
  load_area: string;
  good_for: string[];
  image_url: string | null;
  base_fare: number;
  per_km_fare: number;
  free_loading_minutes: number;
  free_unloading_minutes: number;
  overtime_rate_per_min: number;
  active: boolean;
  sort_order: number;
};

export const VEHICLE_FIELDS =
  "id,label,capacity_label,weight_limit_kg,load_area,good_for,image_url,base_fare,per_km_fare,free_loading_minutes,free_unloading_minutes,overtime_rate_per_min,active,sort_order";

function normalise(row: Record<string, unknown>): VehicleType {
  return {
    id: String(row.id),
    label: String(row.label ?? row.id),
    capacity_label: String(row.capacity_label ?? ""),
    weight_limit_kg: row.weight_limit_kg == null ? null : Number(row.weight_limit_kg),
    load_area: String(row.load_area ?? ""),
    good_for: Array.isArray(row.good_for) ? (row.good_for as string[]) : [],
    image_url: row.image_url == null ? null : String(row.image_url),
    base_fare: Number(row.base_fare ?? 0),
    per_km_fare: Number(row.per_km_fare ?? 0),
    free_loading_minutes: Number(row.free_loading_minutes ?? 60),
    free_unloading_minutes: Number(row.free_unloading_minutes ?? 30),
    overtime_rate_per_min: Number(row.overtime_rate_per_min ?? 2),
    active: Boolean(row.active),
    sort_order: Number(row.sort_order ?? 100),
  };
}

export async function fetchVehicleTypes(includeInactive = false): Promise<VehicleType[]> {
  let q = supabase.from("vehicle_types").select(VEHICLE_FIELDS).order("sort_order");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []).map((r) => normalise(r as Record<string, unknown>));
  registerVehicleLabels(rows);
  return rows;
}

/** Bookable vehicles (or the full catalogue for admin screens). */
export function useVehicleTypes(includeInactive = false) {
  return useQuery({
    queryKey: ["vehicle-types", includeInactive],
    staleTime: 5 * 60_000,
    queryFn: () => fetchVehicleTypes(includeInactive),
  });
}

/**
 * Every vehicle ever offered, keyed by id. Used wherever a past trip must keep
 * rendering its vehicle name after that vehicle has been switched off.
 */
export function useVehicleMap() {
  const all = useVehicleTypes(true);
  const map = new Map<string, VehicleType>((all.data ?? []).map((v) => [v.id, v]));
  return { map, query: all };
}

export function fareFor(v: Pick<VehicleType, "base_fare" | "per_km_fare">, distanceKm: number) {
  if (!distanceKm || distanceKm < 0) return 0;
  return Math.round(v.base_fare + v.per_km_fare * distanceKm);
}

/** Signed URL for a catalogue photo stored in the private vehicle-images bucket. */
export async function vehicleImageSrc(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = await supabase.storage.from("vehicle-images").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
