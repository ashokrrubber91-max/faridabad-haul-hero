import { useEffect, useRef, useState, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, Headphones, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendSupportChat } from "@/lib/chat.functions";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { detectLang, useVoiceInput, useVoiceOutput } from "@/hooks/useVoiceChat";

type Msg = { role: "user" | "assistant"; content: string };

const QUICK: Record<"customer" | "driver", string[]> = {
  customer: [
    "Where is my driver?",
    "Fare dispute / wrong bill",
    "Cancel my ride",
    "Speak to a human",
  ],
  driver: [
    "Incentive nahi mila",
    "Wallet top-up issue",
    "Customer phone off hai",
    "Emergency / accident",
  ],
};

async function buildClientContext(role: "customer" | "driver", userId?: string): Promise<string> {
  if (!userId) return "";
  try {
    const parts: string[] = [];
    const { data: wallet } = await supabase
      .from("wallet_accounts")
      .select("cash_balance,coins_balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (wallet) {
      parts.push(
        role === "driver"
          ? `Driver cash balance: ₹${Number(wallet.cash_balance ?? 0).toFixed(2)}, coins: ${Number(wallet.coins_balance ?? 0)}.`
          : `Wallet coins balance: ${Number(wallet.coins_balance ?? 0)}, cash balance: ₹${Number(wallet.cash_balance ?? 0).toFixed(2)}.`,
      );
    }

    const bookingCol = role === "driver" ? "driver_id" : "customer_id";
    const { data: latest } = await supabase
      .from("bookings")
      .select("id,status,pickup_address,drop_address,fare,vehicle_type,created_at")
      .eq(bookingCol, userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      parts.push(
        `Latest order: id ${String(latest.id).slice(0, 8)}, status ${latest.status}, from "${latest.pickup_address}" to "${latest.drop_address}", fare ₹${latest.fare ?? "?"}.`,
      );
    } else {
      parts.push("No orders/bookings yet.");
    }

    if (role === "driver") {
      const { data: kyc } = await supabase
        .from("driver_kyc")
        .select("status,rejection_reason")
        .eq("driver_id", userId)
        .maybeSingle();
      parts.push(
        kyc
          ? `Driver KYC status: ${kyc.status}${kyc.rejection_reason ? ` (reason: ${kyc.rejection_reason})` : ""}.`
          : "Driver KYC: not submitted yet.",
      );
    }

    return parts.join(" ");
  } catch {
    return "";
  }
}

export function SupportChat({ role }: { role: "customer" | "driver" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        role === "customer"
          ? "Hello! Welcome to **Miniport Support**. How can I help you today?"
          : "Ram Ram! **Miniport Driver Support** me swagat hai. Aaj kya samasya hai?",
    },
  ]);
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const call = useServerFn(sendSupportChat);

  const voiceOut = useVoiceOutput();
  const handleVoiceResult = useCallback((text: string) => {
    setInput(text);
    setTimeout(() => send(text), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const voiceIn = useVoiceInput(handleVoiceResult);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    const next = [...msgs, { role: "user" as const, content: trimmed }];
    setMsgs(next);
    setBusy(true);
    try {
      const clientContext = await buildClientContext(role, user?.id);
      const res = await call({
        data: {
          role,
          clientContext,
          messages: next.map(({ role, content }) => ({ role, content })),
        },
      });
      setMsgs((m) => [...m, { role: "assistant", content: res.reply }]);
      voiceOut.speak(res.reply, detectLang(trimmed));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast.error(msg);
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: "Sorry, I couldn't respond just now. Please try again." },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-105"
          aria-label="Help & Support"
        >
          <MessageCircle className="h-5 w-5" />
          Help & Support
        </button>
      )}

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex justify-end px-0 pb-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:px-0">
          <div className="flex h-[80vh] w-full max-w-md flex-col rounded-t-2xl border border-border bg-background shadow-2xl sm:h-[600px] sm:rounded-2xl">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Headphones className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-display text-base tracking-wide text-secondary">Miniport AI</p>
                  <p className="text-[11px] text-muted-foreground">
                    {role === "customer" ? "Customer help" : "Driver help"} · Faridabad
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {voiceOut.supported && (
                  <button
                    onClick={() => {
                      voiceOut.setMuted((m) => {
                        if (!m) voiceOut.stop();
                        return !m;
                      });
                    }}
                    className="rounded-md p-1.5 hover:bg-muted"
                    aria-label={voiceOut.muted ? "Unmute voice replies" : "Mute voice replies"}
                    title={voiceOut.muted ? "Unmute voice replies" : "Mute voice replies"}
                  >
                    {voiceOut.muted ? (
                      <VolumeX className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Volume2 className="h-4 w-4 text-primary" />
                    )}
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-muted" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {msgs.map((m, i) => (
                <div
                  key={i}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm",
                    )}
                  >
                    {m.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none prose-p:my-1 prose-strong:text-secondary">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Miniport AI Bot is typing…
                </div>
              )}
            </div>

            {msgs.length <= 2 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2">
                {QUICK[role].map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    disabled={busy}
                    className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-secondary transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex gap-2 border-t border-border p-3"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  voiceIn.listening
                    ? "Listening…"
                    : role === "customer"
                      ? "Type your problem here…"
                      : "Apni dikkat yahan likhein…"
                }
                disabled={busy}
              />
              {voiceIn.supported && (
                <Button
                  type="button"
                  size="icon"
                  variant={voiceIn.listening ? "destructive" : "outline"}
                  disabled={busy}
                  onClick={() => (voiceIn.listening ? voiceIn.stop() : voiceIn.start())}
                  aria-label={voiceIn.listening ? "Stop recording" : "Speak your message"}
                  title={voiceIn.listening ? "Stop recording" : "Speak your message"}
                >
                  {voiceIn.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
              <Button type="submit" size="icon" disabled={busy || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
