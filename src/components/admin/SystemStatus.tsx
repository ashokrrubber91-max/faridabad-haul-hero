import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { getSystemStatus } from "@/lib/system-status.functions";

function Row({ label, ok, note }: { label: string; ok: boolean; note: string }) {
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      )}
      <span className="min-w-0">
        <span className="font-medium text-secondary">{label}</span>
        <span className="block text-xs text-muted-foreground">{ok ? "Ready" : note}</span>
      </span>
    </li>
  );
}

/** Live check of which outside services are actually set up for the business. */
export function SystemStatus() {
  const fetchStatus = useServerFn(getSystemStatus);
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fetchStatus(),
    staleTime: 60_000,
  });

  return (
    <section className="surface-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-display text-xl tracking-wide text-secondary">Go-live checklist</h3>
        <p className="text-xs text-muted-foreground">
          What is connected right now — nothing here is assumed.
        </p>
      </div>
      {status.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : status.isError ? (
        <p className="p-4 text-sm text-muted-foreground">Could not read the service status.</p>
      ) : (
        <ul className="grid gap-x-6 px-4 py-3 sm:grid-cols-2">
          <Row
            label="Card / UPI payments"
            ok={!!status.data?.payments.keys}
            note="Payment provider keys are missing — only cash-on-delivery works."
          />
          <Row
            label="Payment confirmations"
            ok={!!status.data?.payments.webhook}
            note="Provider signing secret missing — online payments cannot be confirmed automatically."
          />
          <Row
            label="Driver phone alerts"
            ok={!!status.data?.push.serviceAccount && !!status.data?.push.webConfig}
            note="Push credentials incomplete — drivers only see in-app alerts."
          />
          <Row
            label="Maps & routing"
            ok={!!status.data?.maps.browser && !!status.data?.maps.server}
            note="Map keys incomplete — address search or routing may be limited."
          />
          <Row
            label="Customer SMS"
            ok={!!status.data?.sms.provider}
            note="No SMS provider connected — messages are only recorded in the SMS log, not delivered."
          />
          <Row
            label="Support assistant"
            ok={!!status.data?.ai.gateway}
            note="AI assistant is not connected."
          />
        </ul>
      )}
    </section>
  );
}
