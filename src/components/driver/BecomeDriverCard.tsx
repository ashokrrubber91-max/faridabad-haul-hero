import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

/**
 * Intentional customer → driver onboarding. Applying only records the person's
 * interest; driving is unlocked by the team after document review, so nothing
 * here can grant driver access from the browser.
 */
export function BecomeDriverCard({ userId }: { userId: string }) {
  const qc = useQueryClient();

  const application = useQuery({
    queryKey: ["driver-application", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_applications")
        .select("id, status, decision_note, applied_at, reviewed_at")
        .eq("user_id", userId)
        .order("applied_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const kyc = useQuery({
    queryKey: ["driver-application-kyc", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("driver_kyc")
        .select("status, rejection_reason")
        .eq("driver_id", userId)
        .maybeSingle();
      return data ?? null;
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("driver_applications")
        .insert({ user_id: userId, status: "submitted" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Application started — now add your documents");
      void qc.invalidateQueries({ queryKey: ["driver-application", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const status = application.data?.status ?? null;
  const kycStatus = kyc.data?.status ?? "not_submitted";

  const statusLine =
    kycStatus === "approved"
      ? "Approved — driver mode is active on your account."
      : kycStatus === "pending"
        ? "Documents submitted — our team is reviewing them."
        : kycStatus === "rejected"
          ? (kyc.data?.rejection_reason ?? "Documents were not accepted. Please submit again.")
          : status === "submitted"
            ? "Application started. Add your vehicle and documents to continue."
            : "Drive with MiniPort in Faridabad. You keep your customer account.";

  return (
    <section className="surface-card p-5">
      <h2 className="mb-1 flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
        <Truck className="h-4 w-4 text-primary" /> Become a MiniPort driver
        {kycStatus !== "not_submitted" && (
          <Badge variant="secondary" className="ml-auto capitalize">
            {kycStatus.replace("_", " ")}
          </Badge>
        )}
      </h2>
      <p className="text-sm text-muted-foreground">{statusLine}</p>
      {application.isLoading || kyc.isLoading ? (
        <Loader2 className="mt-3 h-4 w-4 animate-spin text-primary" />
      ) : (
        <div className="mt-3 space-y-2">
          {!status && kycStatus === "not_submitted" && (
            <Button
              className="w-full"
              disabled={apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? "Starting…" : "Apply to drive"}
            </Button>
          )}
          {(status || kycStatus !== "not_submitted") && kycStatus !== "approved" && (
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to="/driver-kyc">
                <Truck className="h-4 w-4" />
                {kycStatus === "not_submitted"
                  ? "Add vehicle & documents"
                  : "Review my documents"}
              </Link>
            </Button>
          )}
          {kycStatus === "approved" && (
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to="/driver">
                <Truck className="h-4 w-4" /> Open driver mode
              </Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
