import { useEffect, useMemo, useState } from "react";
import { MapPin, Mic, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  message_type: "text" | "location" | "voice";
  created_at: string;
};

const QUICK_REPLIES = [
  "Are you coming❓",
  "Waiting at pickup 📍",
  "My location is as per map 🗺️",
  "Message when reached 💬",
];

export function QuickChatModal({
  open,
  onOpenChange,
  bookingId,
  counterpartName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  counterpartName: string;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [quickOpen, setQuickOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const initials = useMemo(
    () => counterpartName.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "DR",
    [counterpartName],
  );

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await (supabase as any)
        .from("booking_messages")
        .select("id,sender_id,body,message_type,created_at")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (!cancelled && !error) setMessages((data ?? []) as ChatMessage[]);
    };
    void load();

    const channel = supabase
      .channel("booking-chat-" + bookingId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "booking_messages", filter: "booking_id=eq." + bookingId },
        (payload) => {
          const row = payload.new as ChatMessage;
          setMessages((prev) => prev.some((m) => m.id === row.id) ? prev : [...prev, row]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [open, user, bookingId]);

  const send = async (value = text, messageType: ChatMessage["message_type"] = "text") => {
    const clean = value.trim();
    if (!clean || !user) return;
    const { error } = await (supabase as any).from("booking_messages").insert({
      booking_id: bookingId,
      sender_id: user.id,
      body: clean,
      message_type: messageType,
    });
    if (error) return toast.error(error.message);
    setText("");
  };

  const shareLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Location is not available on this device");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => void send("Location: " + coords.latitude.toFixed(5) + ", " + coords.longitude.toFixed(5) + " 📍", "location"),
      () => toast.error("Location permission is required to share your location"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const startVoice = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice recording is not supported on this device");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      toast.success("Microphone permission granted. Voice recording can now be enabled.");
    } catch {
      toast.error("Microphone permission is required for voice messages");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[88vh] flex-col rounded-t-2xl p-0">
        <SheetHeader className="border-b px-4 py-4 text-left">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{initials}</div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">Message {counterpartName}</SheetTitle>
              <SheetDescription>Booking #{bookingId.slice(0, 8).toUpperCase()}</SheetDescription>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Do not share any personal details with captain over call or chat</span>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <Collapsible open={quickOpen} onOpenChange={setQuickOpen}>
            <CollapsibleTrigger asChild>
              <button className="mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-semibold">
                <span>Quick Chat</span>
                <span className="text-xs text-muted-foreground">{quickOpen ? "Hide" : "Show"}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-2 sm:grid-cols-2">
              {QUICK_REPLIES.map((reply) => (
                <Button key={reply} type="button" variant="outline" className="justify-start text-left" onClick={() => void send(reply)}>
                  {reply}
                </Button>
              ))}
            </CollapsibleContent>
          </Collapsible>

          <div className="mt-4 space-y-2">
            {messages.length === 0 ? (
              <div className="rounded-xl bg-muted/50 p-4 text-center text-sm text-muted-foreground">Start a safe in-app conversation with your captain.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={m.sender_id === user?.id ? "ml-auto max-w-[82%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground" : "max-w-[82%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm"}>
                  <p>{m.body}</p>
                  <p className="mt-1 text-[10px] opacity-70">{new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t bg-background p-3">
          <div className="mb-2 flex gap-2">
            <Button type="button" variant="outline" size="icon" onClick={() => void startVoice()} aria-label="Voice message"><Mic className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="icon" onClick={shareLocation} aria-label="Share location"><MapPin className="h-4 w-4" /></Button>
            <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send()} placeholder="Type a message…" className="min-w-0" />
            <Button type="button" size="icon" onClick={() => void send()} aria-label="Send message"><Send className="h-4 w-4" /></Button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground">Never share OTP, bank details, passwords or personal contact details.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
