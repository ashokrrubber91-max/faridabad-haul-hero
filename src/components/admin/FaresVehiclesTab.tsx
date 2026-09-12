import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Truck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchVehicleTypes, type VehicleType } from "@/lib/vehicles";
import { useVehicleImage } from "@/components/booking/VehicleCard";

type Draft = {
  id: string;
  label: string;
  capacity_label: string;
  weight_limit_kg: string;
  load_area: string;
  good_for: string;
  base_fare: string;
  per_km_fare: string;
  free_loading_minutes: string;
  free_unloading_minutes: string;
  overtime_rate_per_min: string;
  sort_order: string;
  active: boolean;
  image_url: string | null;
};

const EMPTY: Draft = {
  id: "",
  label: "",
  capacity_label: "",
  weight_limit_kg: "",
  load_area: "",
  good_for: "",
  base_fare: "",
  per_km_fare: "",
  free_loading_minutes: "60",
  free_unloading_minutes: "30",
  overtime_rate_per_min: "2",
  sort_order: "100",
  active: true,
  image_url: null,
};

function toDraft(v: VehicleType): Draft {
  return {
    id: v.id,
    label: v.label,
    capacity_label: v.capacity_label,
    weight_limit_kg: v.weight_limit_kg == null ? "" : String(v.weight_limit_kg),
    load_area: v.load_area,
    good_for: v.good_for.join(", "),
    base_fare: String(v.base_fare),
    per_km_fare: String(v.per_km_fare),
    free_loading_minutes: String(v.free_loading_minutes),
    free_unloading_minutes: String(v.free_unloading_minutes),
    overtime_rate_per_min: String(v.overtime_rate_per_min),
    sort_order: String(v.sort_order),
    active: v.active,
    image_url: v.image_url,
  };
}

/**
 * Vehicles, their fares and their free loading windows are stored in the
 * database and changed here. Every save goes through an admin-only routine on
 * the server, so nothing about pricing is decided in the browser. Trips that
 * were already booked keep the fare they were quoted.
 */
export function FaresVehiclesTab({ lifetimeCommission }: { lifetimeCommission: number }) {
  const [editing, setEditing] = useState<Draft | null>(null);

  const catalogue = useQuery({
    queryKey: ["admin-vehicle-types"],
    queryFn: () => fetchVehicleTypes(true),
  });

  const settings = useQuery({
    queryKey: ["platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("commission_rate")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [commission, setCommission] = useState("10");
  const [savingCommission, setSavingCommission] = useState(false);
  useEffect(() => {
    if (settings.data) setCommission(String(Math.round(Number(settings.data.commission_rate) * 100)));
  }, [settings.data]);

  const saveCommission = async () => {
    const pct = Number(commission);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      toast.error("Commission must be between 0 and 50 percent");
      return;
    }
    setSavingCommission(true);
    const { error } = await supabase.rpc("admin_set_commission_rate", { _rate: pct / 100 });
    setSavingCommission(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Commission set to ${pct}% for new bookings`);
    void settings.refetch();
  };

  const toggleActive = async (v: VehicleType) => {
    const { error } = await supabase.rpc("admin_set_vehicle_active", {
      _id: v.id,
      _active: !v.active,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${v.label} ${v.active ? "hidden from customers" : "available for booking"}`);
    void catalogue.refetch();
  };

  const rows = catalogue.data ?? [];

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <h3 className="font-display text-xl tracking-wide text-secondary">Platform commission</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Applied to bookings created from now on. Lifetime collected:{" "}
          <strong className="text-secondary">₹{lifetimeCommission.toFixed(0)}</strong>
        </p>
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Label>Commission %</Label>
            <Input
              type="number"
              min={0}
              max={50}
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
          </div>
          <Button onClick={saveCommission} disabled={savingCommission || settings.isLoading}>
            {savingCommission ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Existing and completed trips keep the commission they were booked with.
        </p>
      </section>

      <section className="surface-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h3 className="font-display text-xl tracking-wide text-secondary">
              Vehicles &amp; fares
            </h3>
            <p className="text-xs text-muted-foreground">
              Add a vehicle, set its fare, free loading time and photo, or hide it from customers.
            </p>
          </div>
          <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add vehicle
          </Button>
        </div>

        {catalogue.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : catalogue.isError ? (
          <div className="px-4 py-8 text-center text-sm">
            <p className="text-muted-foreground">Could not load the vehicle list.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => catalogue.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No vehicles yet. Add the first one.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((v) => (
              <VehicleRow
                key={v.id}
                vehicle={v}
                onEdit={() => setEditing(toDraft(v))}
                onToggle={() => void toggleActive(v)}
              />
            ))}
          </div>
        )}
      </section>

      <VehicleDialog
        draft={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void catalogue.refetch();
        }}
      />
    </div>
  );
}

function VehicleRow({
  vehicle,
  onEdit,
  onToggle,
}: {
  vehicle: VehicleType;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const img = useVehicleImage(vehicle);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      {img ? (
        <img
          src={img}
          alt={vehicle.label}
          className="h-14 w-20 shrink-0 rounded-md bg-background object-contain"
        />
      ) : (
        <span className="grid h-14 w-20 shrink-0 place-items-center rounded-md bg-muted">
          <Truck className="h-5 w-5 text-muted-foreground" />
        </span>
      )}
      <div className="min-w-[160px] flex-1">
        <p className="text-sm font-semibold text-secondary">{vehicle.label}</p>
        <p className="text-xs text-muted-foreground">
          {vehicle.id} · {vehicle.capacity_label || "capacity not set"} · ₹{vehicle.base_fare} + ₹
          {vehicle.per_km_fare}/km
        </p>
        <p className="text-xs text-muted-foreground">
          Free {vehicle.free_loading_minutes} min loading · {vehicle.free_unloading_minutes} min
          unloading · ₹{vehicle.overtime_rate_per_min}/min after that
        </p>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={vehicle.active} onCheckedChange={onToggle} />
          {vehicle.active ? "Bookable" : "Hidden"}
        </label>
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function VehicleDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Draft>(draft ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isNew = !draft?.id;

  useEffect(() => {
    if (draft) setForm(draft);
  }, [draft]);

  const set = (k: keyof Draft, value: string | boolean | null) =>
    setForm((f) => ({ ...f, [k]: value }) as Draft);

  const uploadPhoto = async (file: File) => {
    const id = form.id.trim() || "new";
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("vehicle-images").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    setUploading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    set("image_url", path);
    toast.success("Photo uploaded");
  };

  const save = async () => {
    const id = form.id.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,40}$/.test(id)) {
      toast.error("Use a simple id like bike_delivery (letters, numbers, underscore)");
      return;
    }
    if (form.label.trim().length < 2) {
      toast.error("Give the vehicle a name customers will recognise");
      return;
    }
    const nums = {
      base: Number(form.base_fare),
      perKm: Number(form.per_km_fare),
      load: Number(form.free_loading_minutes),
      unload: Number(form.free_unloading_minutes),
      rate: Number(form.overtime_rate_per_min),
      sort: Number(form.sort_order),
      weight: form.weight_limit_kg.trim() === "" ? 0 : Number(form.weight_limit_kg),
    };
    if (Object.values(nums).some((n) => !Number.isFinite(n) || n < 0)) {
      toast.error("Fares, minutes and weight must be zero or more");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("admin_upsert_vehicle_type", {
      _id: id,
      _label: form.label.trim(),
      _capacity_label: form.capacity_label.trim(),
      _weight_limit_kg: nums.weight,
      _load_area: form.load_area.trim(),
      _good_for: form.good_for
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      _base_fare: nums.base,
      _per_km_fare: nums.perKm,
      _free_loading_minutes: Math.round(nums.load),
      _free_unloading_minutes: Math.round(nums.unload),
      _overtime_rate_per_min: nums.rate,
      _sort_order: Math.round(nums.sort),
      _active: form.active,
      _image_url: form.image_url ?? undefined,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${form.label.trim()} saved`);
    onSaved();
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add a vehicle" : `Edit ${draft?.label}`}</DialogTitle>
          <DialogDescription>
            Customers see this vehicle, its photo and its fare while booking. Past trips keep their
            original fare.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Name shown to customers</Label>
            <Input value={form.label} onChange={(e) => set("label", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Internal id</Label>
            <Input
              value={form.id}
              disabled={!isNew}
              placeholder="bike_delivery"
              onChange={(e) => set("id", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Capacity shown</Label>
            <Input
              value={form.capacity_label}
              placeholder="20 kg"
              onChange={(e) => set("capacity_label", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Weight limit (kg)</Label>
            <Input
              type="number"
              value={form.weight_limit_kg}
              onChange={(e) => set("weight_limit_kg", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Load area</Label>
            <Input
              value={form.load_area}
              placeholder="Delivery box"
              onChange={(e) => set("load_area", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Best for (comma separated)</Label>
            <Input
              value={form.good_for}
              placeholder="Documents, food, small parcels"
              onChange={(e) => set("good_for", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Base fare (₹)</Label>
            <Input
              type="number"
              value={form.base_fare}
              onChange={(e) => set("base_fare", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Per km (₹)</Label>
            <Input
              type="number"
              value={form.per_km_fare}
              onChange={(e) => set("per_km_fare", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Free loading (min)</Label>
            <Input
              type="number"
              value={form.free_loading_minutes}
              onChange={(e) => set("free_loading_minutes", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Free unloading (min)</Label>
            <Input
              type="number"
              value={form.free_unloading_minutes}
              onChange={(e) => set("free_unloading_minutes", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Waiting charge (₹/min)</Label>
            <Input
              type="number"
              value={form.overtime_rate_per_min}
              onChange={(e) => set("overtime_rate_per_min", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Order in list</Label>
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) => set("sort_order", e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <Label className="text-xs">Photo</Label>
            <div className="mt-1 flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <Upload className="h-4 w-4 text-primary" />
                {uploading ? "Uploading…" : form.image_url ? "Replace photo" : "Upload photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadPhoto(f);
                  }}
                />
              </label>
              {form.image_url && (
                <p className="truncate text-xs text-muted-foreground">{form.image_url}</p>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Without a photo, built-in artwork or a truck icon is shown.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
            Available for customers to book
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || uploading}>
            {busy ? "Saving…" : "Save vehicle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
