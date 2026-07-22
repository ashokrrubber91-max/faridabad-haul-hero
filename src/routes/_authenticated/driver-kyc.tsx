import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, Upload, ShieldCheck, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { VEHICLES } from "@/lib/booking";

export const Route = createFileRoute("/_authenticated/driver-kyc")({
  head: () => ({ meta: [{ title: "Driver verification — MiniPort" }] }),
  component: DriverKycPage,
});

type DocKey = "dl_front" | "dl_back" | "rc" | "id_proof" | "vehicle_photo";
const DOC_LABELS: Record<DocKey, string> = {
  dl_front: "Driving licence — front",
  dl_back: "Driving licence — back",
  rc: "Vehicle RC (Registration Certificate)",
  id_proof: "ID proof (Aadhaar / PAN / Voter ID)",
  vehicle_photo: "Vehicle photo with number plate",
};
const DOC_ORDER: DocKey[] = ["dl_front", "dl_back", "rc", "id_proof", "vehicle_photo"];

function DriverKycPage() {
  const { user, role, roles, loading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState("");
  const [city, setCity] = useState("Faridabad");
  const [vehicleId, setVehicleId] = useState<string>(VEHICLES[0].id);
  const [files, setFiles] = useState<Partial<Record<DocKey, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<DocKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const existing = useQuery({
    queryKey: ["driver-kyc", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("driver_kyc" as never)
        .select("*")
        .eq("driver_id", user!.id)
        .maybeSingle();
      return data as { status?: string; rejection_reason?: string | null } | null;
    },
  });

  useEffect(() => {
    return () => {
      Object.values(previews).forEach((url) => url && URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Center><Loader2 className="h-5 w-5 animate-spin text-primary" /></Center>;
  if (role && role !== "driver" && role !== "admin" && !roles.includes("driver")) {
    return <Navigate to="/customer" />;
  }

  const status = existing.data?.status;
  if (status === "pending" || status === "approved") {
    return <StatusScreen status={status} rejectionReason={null} />;
  }

  const pickFile = (key: DocKey, file: File | null) => {
    setFiles((prev) => {
      const next = { ...prev };
      if (file) next[key] = file;
      else delete next[key];
      return next;
    });
    setPreviews((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key]!);
      const next = { ...prev };
      if (file) next[key] = URL.createObjectURL(file);
      else delete next[key];
      return next;
    });
  };

  const submit = async () => {
    if (!user) return;
    if (fullName.trim().length < 2) return toast.error("Enter your full name");
    if (!vehicleId) return toast.error("Choose your vehicle");
    for (const k of DOC_ORDER) {
      if (!files[k]) return toast.error(`Upload ${DOC_LABELS[k]}`);
    }
    setSubmitting(true);
    try {
      const urls: Record<string, string> = {};
      for (const key of DOC_ORDER) {
        const f = files[key]!;
        const ext = f.name.split(".").pop() ?? "jpg";
        const path = `${user.id}/${key}-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from("driver-kyc").upload(path, f, {
          upsert: true,
          cacheControl: "3600",
        });
        if (error) throw error;
        urls[key] = path;
      }
      const { error: insertErr } = await supabase.from("driver_kyc" as never).upsert(
        {
          driver_id: user.id,
          full_name: fullName.trim(),
          city: city.trim() || "Faridabad",
          vehicle_id: vehicleId,
          dl_front_url: urls.dl_front,
          dl_back_url: urls.dl_back,
          rc_url: urls.rc,
          id_proof_url: urls.id_proof,
          vehicle_photo_url: urls.vehicle_photo,
          status: "pending",
          rejection_reason: null,
          submitted_at: new Date().toISOString(),
          reviewed_at: null,
          reviewed_by: null,
        } as never,
      );
      if (insertErr) throw insertErr;
      toast.success("KYC submitted — admin will review within 24 hours");
      navigate({ to: "/driver" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="surface-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="font-display text-2xl tracking-wide text-secondary">Driver verification</h1>
          </div>
          <p className="text-xs text-muted-foreground">Step {step} of 3</p>
        </div>
        <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(step / 3) * 100}%` }} />
        </div>

        {status === "rejected" && (
          <div className="mb-4 rounded-md border border-destructive bg-destructive/5 p-3 text-sm">
            <p className="font-semibold text-destructive">Your previous submission was rejected</p>
            <p className="text-muted-foreground">{existing.data?.rejection_reason ?? "Please re-upload correct documents."}</p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-secondary">Personal details</p>
            <div>
              <Label htmlFor="fname">Full name (as on ID)</Label>
              <Input id="fname" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={40} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-secondary">Choose your vehicle</p>
            <div className="grid gap-2">
              {VEHICLES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVehicleId(v.id)}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    vehicleId === v.id ? "border-primary bg-accent" : "border-border hover:bg-muted"
                  }`}
                >
                  <p className="text-sm font-semibold text-secondary">{v.label}</p>
                  <p className="text-xs text-muted-foreground">Up to {v.capacity} · ₹{v.perKm}/km</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-secondary">Upload documents</p>
            <p className="text-xs text-muted-foreground">Clear photos only. Max 5 MB each.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {DOC_ORDER.map((k) => (
                <DocSlot
                  key={k}
                  label={DOC_LABELS[k]}
                  preview={previews[k]}
                  onFile={(f) => pickFile(k, f)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || submitting}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => {
                if (step === 1 && fullName.trim().length < 2) return toast.error("Enter your full name");
                setStep((s) => s + 1);
              }}
            >
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit for review"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DocSlot({ label, preview, onFile }: { label: string; preview?: string; onFile: (f: File | null) => void }) {
  return (
    <label className="flex cursor-pointer flex-col rounded-md border border-dashed border-border bg-background p-3 hover:bg-muted">
      <p className="text-xs font-semibold text-secondary">{label}</p>
      {preview ? (
        <div className="relative mt-2 h-32 w-full overflow-hidden rounded-md bg-muted">
          <img src={preview} alt={label} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onFile(null);
            }}
            className="absolute right-1 top-1 rounded-full bg-background/90 p-1 shadow"
            aria-label="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="mt-2 flex h-32 items-center justify-center rounded-md bg-muted/40 text-xs text-muted-foreground">
          <Upload className="mr-1 h-4 w-4" /> Tap to upload
        </div>
      )}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f && f.size > 5 * 1024 * 1024) {
            toast.error("File too large (max 5 MB)");
            return;
          }
          onFile(f);
        }}
      />
    </label>
  );
}

function StatusScreen({ status, rejectionReason }: { status: string; rejectionReason: string | null }) {
  const isApproved = status === "approved";
  return (
    <div className="mx-auto max-w-md">
      <div className="surface-card p-6 text-center">
        {isApproved ? (
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        ) : (
          <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
        )}
        <h1 className="mt-3 font-display text-2xl tracking-wide text-secondary">
          {isApproved ? "You're verified" : "Verification pending"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isApproved
            ? "Your documents are approved. You can start accepting rides."
            : "Admin will review your submission within 24 hours. We'll notify you once you're approved."}
        </p>
        {rejectionReason && (
          <p className="mt-3 rounded-md bg-destructive/10 p-3 text-xs text-destructive">{rejectionReason}</p>
        )}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[50vh] items-center justify-center">{children}</div>;
}
