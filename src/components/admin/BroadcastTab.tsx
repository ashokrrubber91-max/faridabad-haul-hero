import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

type Broadcast = {
  id: string;
  audience: string;
  title: string;
  body: string;
  recipient_count: number;
  sms_status: string;
  created_at: string;
};

/**
 * Real in-app announcements. Each send creates one message per recipient, which
 * they see in Account → Notifications. Text messages stay marked as not sent
 * until an SMS provider is connected — nothing here pretends an SMS went out.
 */
export function BroadcastTab({
  drivers,
  customers,
}: {
  drivers: unknown[];
  customers: unknown[];
}) {
  const [audience, setAudience] = useState<"driver" | "customer" | "all">("driver");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // One key per composed message: tapping Send twice cannot deliver it twice.
  const [key, setKey] = useState(() => crypto.randomUUID());

  const history = useQuery({
    queryKey: ["admin-broadcasts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("broadcasts")
        .select("id, audience, title, body, recipient_count, sms_status, created_at")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as Broadcast[];
    },
  });

  const send = async () => {
    if (title.trim().length < 3) return toast.error("Add a short headline");
    if (message.trim().length < 3) return toast.error("Enter a message");
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_send_broadcast", {
      _audience: audience,
      _title: title.trim(),
      _body: message.trim(),
      _idempotency_key: key,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = data as unknown as Broadcast | null;
    toast.success(
      row ? `Delivered in-app to ${row.recipient_count} people` : "Announcement recorded",
    );
    setTitle("");
    setMessage("");
    setKey(crypto.randomUUID());
    void history.refetch();
  };

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <h3 className="font-display text-xl tracking-wide text-secondary">Send an announcement</h3>
        <p className="text-xs text-muted-foreground">
          Delivered instantly inside the app to everyone in the audience you pick. Text messages are
          only sent once an SMS provider is connected — until then they stay marked as not sent.
        </p>
        <div className="mt-3 space-y-2">
          <div>
            <Label className="text-xs">Audience</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as typeof audience)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="driver">Drivers ({drivers.length})</SelectItem>
                <SelectItem value="customer">Customers ({customers.length})</SelectItem>
                <SelectItem value="all">Everyone</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Headline</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Rain bonus is live"
            />
          </div>
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={600}
              placeholder="₹50 extra on every trip completed before 8 PM today."
            />
          </div>
          <Button onClick={send} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Send className="mr-1 h-3.5 w-3.5" /> Send announcement
              </>
            )}
          </Button>
        </div>
      </section>

      <section className="surface-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-display text-xl tracking-wide text-secondary">Recent announcements</h3>
        </div>
        {history.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : history.isError ? (
          <div className="px-4 py-8 text-center text-sm">
            <p className="text-muted-foreground">Could not load past announcements.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => history.refetch()}>
              Retry
            </Button>
          </div>
        ) : (history.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing sent yet.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {(history.data ?? []).map((b) => (
              <div key={b.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-secondary">{b.title}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{b.audience}</Badge>
                    <Badge variant="secondary">In-app: {b.recipient_count}</Badge>
                    <Badge
                      className={
                        b.sms_status === "sent"
                          ? "bg-success text-success-foreground"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      SMS: {b.sms_status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{b.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(b.created_at).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
