import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

const DOCS = [
  ["dl_front_url", "Licence front"],
  ["dl_back_url", "Licence back"],
  ["rc_url", "RC"],
  ["id_proof_url", "ID proof"],
  ["vehicle_photo_url", "Vehicle photo"],
  ["number_plate_url", "Number plate"],
  ["insurance_url", "Insurance"],
  ["puc_url", "PUC"],
] as const;

type Kyc = Record<string, any>;

export function KycReviewTab() {
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const kyc = useQuery({
    queryKey: ["admin-kyc", filter],
    queryFn: async () => {
      let q = supabase.from("driver_kyc").select("*").order("submitted_at", { ascending: false });
      if (filter === "pending") q = q.eq("status", "pending");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Kyc[];
    },
  });

  const rows = kyc.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant={filter === "pending" ? "default" : "outline"} onClick={() => setFilter("pending")}>
          Awaiting review
        </Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
          All submissions
        </Button>
      </div>

      {kyc.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <p className="surface-card p-6 text-center text-sm text-muted-foreground">No submissions here.</p>
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <KycCard key={r.driver_id} row={r} onChanged={() => kyc.refetch()} />
          ))}
        </div>
      )}
    </section>
  );
}

function KycCard({ row, onChanged }: { row: Kyc; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = async (status: "approved" | "rejected") => {
    if (status === "rejected" && reason.trim().length < 4) {
      toast.error("Add a rejection reason for the driver");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("driver_kyc")
      .update({
        status,
        rejection_reason: status === "rejected" ? reason.trim() : null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("driver_id", row.driver_id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(status === "approved" ? "Driver verified — can now accept rides" : "Submission rejected");
    onChanged();
  };

  const openDoc = async (path: string) => {
    const { data, error } = await supabase.storage.from("driver-kyc").createSignedUrl(path, 300);
    if (error || !data) {
      toast.error("Could not open document");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const tone =
    row.status === "approved" ? "bg-success text-success-foreground" : row.status === "rejected" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground";

  return (
    <article className="surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl tracking-wide text-secondary">{row.full_name}</p>
          <p className="text-xs text-muted-foreground">
            {row.city} · Vehicle {row.vehicle_id}
            {row.vehicle_number ? ` · ${row.vehicle_number}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Submitted {new Date(row.submitted_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <Badge className={tone}>{row.status}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {DOCS.filter(([k]) => row[k]).map(([k, label]) => (
          <Button key={k} size="sm" variant="outline" onClick={() => openDoc(row[k])}>
            {label}
          </Button>
        ))}
      </div>

      {row.status === "rejected" && row.rejection_reason && (
        <p className="mt-2 text-xs text-destructive">Reason: {row.rejection_reason}</p>
      )}

      {row.status !== "approved" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Rejection reason (if rejecting)"
            className="max-w-xs"
          />
          <Button size="sm" onClick={() => decide("approved")} disabled={busy}>
            <ShieldCheck className="h-3.5 w-3.5" /> Approve
          </Button>
          <Button size="sm" variant="destructive" onClick={() => decide("rejected")} disabled={busy}>
            <ShieldX className="h-3.5 w-3.5" /> Reject
          </Button>
        </div>
      )}
    </article>
  );
}
