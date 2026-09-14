import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileImage, Loader2, Save, ShieldCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVehicleTypes } from "@/lib/vehicles";

const DOCS = [
  ["driver_photo_url", "Driver photo"],
  ["vehicle_photo_url", "Vehicle photo"],
  ["insurance_url", "Insurance photo"],
  ["puc_url", "PUC photo"],
  ["number_plate_url", "Number plate photo"],
  ["poc_photo_url", "Contact person photo"],
] as const;
type DocKey = (typeof DOCS)[number][0];

/** Documents captured during KYC; shown here read-only so drivers can verify them. */
const KYC_DOCS = [
  ["dl_front_url", "Driving licence — front"],
  ["dl_back_url", "Driving licence — back"],
  ["rc_url", "Registration certificate (RC)"],
  ["id_proof_url", "ID proof"],
] as const;

const STATUS_LABEL: Record<string, string> = {
  not_submitted: "Not submitted",
  pending: "Under review",
  approved: "Verified",
  rejected: "Rejected",
};

export function DriverAccountProfile() {
  const { user, profile, activeMode, setActiveMode, roles } = useAuth();
  const qc = useQueryClient();
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [pocName, setPocName] = useState("");
  const [pocPhone, setPocPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const vehicles = useVehicleTypes(true);
  const kyc = useQuery({
    queryKey: ["driver-account-kyc", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_kyc")
        .select("*")
        .eq("driver_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const row = kyc.data;
  const currentVehicle = vehicles.data?.find((v) => v.id === row?.vehicle_id);
  const status = row?.status ?? profile?.kyc_status ?? "not_submitted";

  const save = async () => {
    if (!user) return;
    const value = vehicleNumber.trim() || row?.vehicle_number || "";
    if (value && (value.length < 4 || value.length > 20))
      return toast.error("Enter a valid vehicle registration number");
    const name = pocName.trim();
    if (name && (name.length < 2 || name.length > 80))
      return toast.error("Enter a valid contact person name");
    const phoneDigits = pocPhone.replace(/\D/g, "");
    if (phoneDigits && !/^[6-9]\d{9}$/.test(phoneDigits))
      return toast.error("Enter a valid 10-digit contact phone number");
    setSaving(true);
    const { error } = await supabase.rpc("driver_update_account_profile", {
      _vehicle_number: value || undefined,
      _poc_name: name || undefined,
      _poc_phone: phoneDigits || undefined,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Driver profile saved");
    setVehicleNumber("");
    setPocName("");
    setPocPhone("");
    qc.invalidateQueries({ queryKey: ["driver-account-kyc", user.id] });
  };
  const upload = async (key: DocKey, file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image file");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image must be 8 MB or smaller");
    setUploading(key);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/account-${key}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("driver-kyc")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      setUploading(null);
      return toast.error(uploadError.message);
    }
    const { error } = await supabase.rpc("driver_update_account_profile", {
      _vehicle_photo_url: key === "vehicle_photo_url" ? path : undefined,
      _insurance_url: key === "insurance_url" ? path : undefined,
      _puc_url: key === "puc_url" ? path : undefined,
      _number_plate_url: key === "number_plate_url" ? path : undefined,
      _driver_photo_url: key === "driver_photo_url" ? path : undefined,
      _poc_photo_url: key === "poc_photo_url" ? path : undefined,
    });
    setUploading(null);
    if (error) return toast.error(error.message);
    toast.success(`${DOCS.find(([k]) => k === key)?.[1] ?? "Document"} uploaded`);
    qc.invalidateQueries({ queryKey: ["driver-account-kyc", user.id] });
  };
  const openDoc = async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("driver-kyc").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return toast.error("Could not open this document");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const switchMode = async () => {
    try {
      await setActiveMode(activeMode === "driver" ? "customer" : "driver");
      toast.success(
        activeMode === "driver" ? "Switched to customer mode" : "Switched to driver mode",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section className="surface-card p-5">
      <div className="flex items-start gap-3">
        <div className="brand-gradient grid h-11 w-11 shrink-0 place-items-center rounded-full">
          <Truck className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl tracking-wide text-secondary">
            Driver account profile
          </h2>
          <p className="text-xs text-muted-foreground">
            Vehicle, driver photo, contact person and documents. GSTIN and saved customer addresses
            are not part of a driver profile.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge
          variant={
            status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary"
          }
        >
          <ShieldCheck className="mr-1 h-3.5 w-3.5" /> KYC: {STATUS_LABEL[status] ?? status}
        </Badge>
        {status !== "approved" && (
          <Button size="sm" variant="outline" asChild>
            <Link to="/driver-kyc">
              {status === "not_submitted" ? "Start verification" : "View verification"}
            </Link>
          </Button>
        )}
      </div>
      {status === "rejected" && row?.rejection_reason && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          Reason: {row.rejection_reason}
        </p>
      )}

      {roles.includes("customer") && (
        <div className="mt-4 rounded-md border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-secondary">Account mode</p>
              <p className="text-xs text-muted-foreground">
                Switch between your customer and driver experience without signing out.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void switchMode()}>
              {activeMode === "driver" ? "Switch to customer" : "Switch to driver"}
            </Button>
          </div>
        </div>
      )}
      {kyc.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="drv-name">Driver name</Label>
              <Input id="drv-name" value={profile?.name ?? row?.full_name ?? ""} readOnly />
            </div>
            <div>
              <Label htmlFor="drv-vnum">Vehicle number</Label>
              <Input
                id="drv-vnum"
                placeholder={row?.vehicle_number || "HR29AB1234"}
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value.toUpperCase().slice(0, 20))}
              />
            </div>
            <div>
              <Label htmlFor="drv-poc">Contact person (POC) name</Label>
              <Input
                id="drv-poc"
                placeholder={row?.poc_name || "Owner / emergency contact"}
                value={pocName}
                onChange={(e) => setPocName(e.target.value.slice(0, 80))}
              />
            </div>
            <div>
              <Label htmlFor="drv-poc-phone">Contact person phone</Label>
              <Input
                id="drv-poc-phone"
                inputMode="numeric"
                placeholder={row?.poc_phone || "10-digit mobile"}
                value={pocPhone}
                onChange={(e) => setPocPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
            </div>
          </div>
          <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save driver details"}
          </Button>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-semibold text-secondary">Vehicle type</p>
            <p className="text-muted-foreground">
              {currentVehicle?.label ?? row?.vehicle_id ?? "Not selected"}
              {row?.vehicle_number ? ` · ${row.vehicle_number}` : ""}
            </p>
            {currentVehicle && (
              <p className="mt-1 text-xs text-muted-foreground">
                Up to{" "}
                {currentVehicle.capacity_label ||
                  (currentVehicle.weight_limit_kg
                    ? `${currentVehicle.weight_limit_kg} kg`
                    : "capacity not set")}{" "}
                · {currentVehicle.load_area || "load dimensions not set"}
              </p>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {DOCS.map(([key, label]) => {
              const path = row?.[key] as string | null | undefined;
              return (
                <div key={key} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-secondary">{label}</p>
                      <p className="text-xs text-muted-foreground">
                        {path ? "Uploaded" : "Not uploaded"}
                      </p>
                    </div>
                    {path && (
                      <Button size="sm" variant="outline" onClick={() => void openDoc(path)}>
                        View
                      </Button>
                    )}
                  </div>
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-primary">
                    <FileImage className="h-4 w-4" />{" "}
                    {uploading === key ? "Uploading…" : "Upload / replace"}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={uploading !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(key, file);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              );
            })}
          </div>
          <div className="rounded-md border p-3">
            <p className="text-sm font-semibold text-secondary">Verification documents</p>
            <p className="text-xs text-muted-foreground">
              Submitted during KYC. Re-submit from the verification screen if any of these change.
            </p>
            <ul className="mt-2 divide-y divide-border">
              {KYC_DOCS.map(([key, label]) => {
                const path = row?.[key] as string | null | undefined;
                return (
                  <li key={key} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-secondary">{label}</span>
                    {path ? (
                      <Button size="sm" variant="ghost" onClick={() => void openDoc(path)}>
                        View
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not uploaded</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            Replacing any photo sends your profile back to the operations team for review.
          </p>
        </div>
      )}
    </section>
  );
}
