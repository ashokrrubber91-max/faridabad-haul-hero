import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasCurrentConsent, recordConsent, TERMS_VERSION } from "@/lib/legal";

/**
 * Version-based re-consent. Only shows when this account has not accepted the
 * current policy versions — existing users are never marked as accepting a new
 * version silently, and nobody is re-asked on every login.
 */
export function LegalConsentCard({ userId }: { userId: string }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const consent = useQuery({
    queryKey: ["consent", userId, TERMS_VERSION],
    queryFn: () => hasCurrentConsent(userId),
  });

  if (done || consent.data !== false) return null;

  const accept = async () => {
    setBusy(true);
    const ok = await recordConsent("reconsent");
    setBusy(false);
    if (!ok) return toast.error("We could not save your acceptance. Please try again.");
    toast.success("Thank you — your acceptance is recorded.");
    setDone(true);
  };

  return (
    <section className="surface-card border-primary/30 p-5">
      <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
        <FileText className="h-4 w-4 text-primary" /> Updated Terms &amp; Privacy Policy
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Our{" "}
        <a
          href="/terms.html"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline"
        >
          Terms &amp; Conditions
        </a>{" "}
        and{" "}
        <a
          href="/privacy.html"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline"
        >
          Privacy Policy
        </a>{" "}
        (version {TERMS_VERSION}) have not been accepted on this account yet. Please read and accept
        them.
      </p>
      <Button className="mt-3" onClick={accept} disabled={busy}>
        {busy ? "Saving…" : "I accept"}
      </Button>
    </section>
  );
}
