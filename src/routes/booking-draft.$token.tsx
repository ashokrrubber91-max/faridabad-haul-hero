import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, MapPin, Truck, CalendarClock } from "lucide-react";
import { getVoiceBookingDraft } from "@/lib/voice-draft.functions";

export const Route = createFileRoute("/booking-draft/$token")({
  loader: ({ params }) => getVoiceBookingDraft({ data: { token: params.token } }),
  head: () => ({ meta: [{ title: "MiniPort booking draft" }] }),
  component: VoiceBookingDraftPage,
});

function VoiceBookingDraftPage() {
  const draft = Route.useLoaderData();
  if (!draft) return <main className="mx-auto min-h-screen max-w-2xl p-5"><div className="surface-card p-5 text-sm text-muted-foreground">Draft not found or expired.</div></main>;
  const data = (draft.parsed_data ?? {}) as any;
  const download = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "miniport-booking-draft.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return <main className="mx-auto min-h-screen max-w-2xl space-y-5 p-5">
    <header className="surface-card p-5">
      <h1 className="font-display text-3xl tracking-wide text-secondary">MiniPort booking draft</h1>
      <p className="mt-1 text-sm text-muted-foreground">Generated from your WhatsApp voice note. Review before booking.</p>
      <Badge className="mt-3">{draft.status}</Badge>
    </header>
    <section className="surface-card space-y-4 p-5">
      <Row icon={<MapPin className="h-4 w-4 text-primary"/>} label="Pickup" value={data.pickup || "Not detected"}/>
      <Row icon={<MapPin className="h-4 w-4 text-success"/>} label="Drop" value={data.drop || "Not detected"}/>
      <Row icon={<Truck className="h-4 w-4 text-primary"/>} label="Vehicle" value={data.vehicle || "Not detected"}/>
      {data.scheduledFor && <Row icon={<CalendarClock className="h-4 w-4 text-primary"/>} label="Scheduled" value={new Date(data.scheduledFor).toLocaleString("en-IN")}/>}
      <Row icon={<Truck className="h-4 w-4 text-muted-foreground"/>} label="Helpers" value={String(data.helperCount ?? 0)}/>
      {data.cargoValue ? <Row icon={<Truck className="h-4 w-4 text-muted-foreground"/>} label="Cargo value" value={`₹${data.cargoValue}`}/> : null}
      {data.notes && <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Notes</p><p className="mt-1 text-sm text-secondary">{data.notes}</p></div>}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={download}><Download className="h-4 w-4"/> Download draft</Button>
        <Button asChild variant="outline"><Link to="/customer">Open MiniPort booking</Link></Button>
      </div>
    </section>
    <p className="text-xs text-muted-foreground">Draft expires {new Date(draft.expires_at).toLocaleString("en-IN")}.</p>
  </main>;
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-start gap-3 rounded-md border p-3"><div className="mt-0.5">{icon}</div><div className="min-w-0"><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-0.5 text-sm font-semibold text-secondary">{value}</p></div></div>;
}
