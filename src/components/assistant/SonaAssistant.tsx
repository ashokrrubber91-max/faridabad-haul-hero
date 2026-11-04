import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { Bot, Mic, MicOff, Volume2, VolumeX, Settings2, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { detectLang, useVoiceInput, useVoiceOutput, type DetectedLang } from "@/hooks/useVoiceChat";
import { supabase } from "@/integrations/supabase/client";

type SonaMessage = { id: number; role: "user" | "assistant"; text: string };
type BookingSummary = {
  id: string;
  status: string;
  pickup_address: string;
  drop_address: string;
  fare: number;
  created_at: string;
  driver_net_earning?: number;
};

const LANGUAGES: Array<{ label: string; value: DetectedLang }> = [
  { label: "Auto / Hindi", value: "hi-IN" },
  { label: "English (India)", value: "en-IN" },
  { label: "Punjabi", value: "pa-IN" },
  { label: "Bengali", value: "bn-IN" },
  { label: "Marathi", value: "mr-IN" },
  { label: "Tamil", value: "ta-IN" },
  { label: "Telugu", value: "te-IN" },
  { label: "Gujarati", value: "gu-IN" },
];

function normalize(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[.,!?।]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

export function SonaAssistant() {
  const { user, role, profile } = useAuth();
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistantName, setAssistantName] = useState("Sona");
  const [nameDraft, setNameDraft] = useState("Sona");
  const [language, setLanguage] = useState<DetectedLang>("hi-IN");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<SonaMessage[]>([
    {
      id: 1,
      role: "assistant",
      text: "Namaste! Main Sona hoon. Aap wallet, rides, booking ya support ke baare mein pooch sakte hain.",
    },
  ]);
  const voiceOut = useVoiceOutput();

  useEffect(() => {
    try {
      const savedName = window.localStorage.getItem("miniport.sona.name");
      const savedLanguage = window.localStorage.getItem("miniport.sona.language");
      if (savedName?.trim()) {
        setAssistantName(savedName.trim().slice(0, 24));
        setNameDraft(savedName.trim().slice(0, 24));
      }
      if (savedLanguage && LANGUAGES.some((item) => item.value === savedLanguage)) {
        setLanguage(savedLanguage as DetectedLang);
      }
    } catch {
      // Storage can be disabled; session defaults remain usable.
    }
  }, []);

  const say = useCallback(
    (text: string, lang: DetectedLang) => voiceOut.speak(text, lang),
    [voiceOut],
  );
  const addMessage = useCallback((roleValue: SonaMessage["role"], text: string) => {
    setMessages((current) => [
      ...current.slice(-11),
      { id: Date.now() + current.length, role: roleValue, text },
    ]);
  }, []);

  const processCommand = useCallback(
    async (raw: string) => {
      const spoken = raw.trim();
      if (!spoken || busy) return;
      setBusy(true);
      addMessage("user", spoken);
      setInput("");
      const detected = language === "hi-IN" ? detectLang(spoken) : language;
      const text = normalize(spoken).replace(
        new RegExp(
          "^" + assistantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLocaleLowerCase() + "[, ]*",
        ),
        "",
      );
      const isDriver = role === "driver";
      const isCustomer = role === "customer";
      let reply = "";
      let destination:
        | "/customer"
        | "/driver"
        | "/orders"
        | "/driver-rides"
        | "/wallet"
        | "/refer"
        | "/account"
        | null = null;

      try {
        if (!user || (!isDriver && !isCustomer)) {
          reply = "Please sign in to use your MiniPort account assistant.";
        } else if (
          containsAny(text, [
            "wallet",
            "balance",
            "paisa",
            "paise",
            "kitna paisa",
            "बैलेंस",
            "वॉलेट",
            "पैसे",
          ])
        ) {
          const { data, error } = await supabase
            .from("wallet_accounts")
            .select("cash_balance,coins_balance")
            .eq("user_id", user.id)
            .maybeSingle();
          if (error) throw error;
          const cash = Number(data?.cash_balance ?? 0);
          const coins = Number(data?.coins_balance ?? 0);
          reply =
            detected === "hi-IN"
              ? `Aapke wallet mein ₹${cash.toFixed(0)} cash aur ${coins} coins hain.`
              : `Your wallet has ₹${cash.toFixed(0)} cash and ${coins} coins.`;
          destination = "/wallet";
        } else if (
          containsAny(text, [
            "history",
            "orders",
            "rides",
            "booking history",
            "meri ride",
            "मेरी राइड",
            "ऑर्डर",
            "बुकिंग",
          ])
        ) {
          const ownerColumn = isDriver ? "driver_id" : "customer_id";
          const { data, error } = await supabase
            .from("bookings")
            .select("id,status,pickup_address,drop_address,fare,created_at,driver_net_earning")
            .eq(ownerColumn, user.id)
            .order("created_at", { ascending: false })
            .limit(5);
          if (error) throw error;
          const rows = (data ?? []) as BookingSummary[];
          if (!rows.length) {
            reply =
              detected === "hi-IN"
                ? "Abhi aapki koi ride history nahi mili."
                : "You don't have any rides yet.";
          } else {
            const latest = rows[0];
            reply =
              detected === "hi-IN"
                ? `Aapki ${rows.length} recent rides mili. Latest ride ka status ${latest.status} hai, pickup ${latest.pickup_address}, drop ${latest.drop_address}, fare ₹${Number(latest.fare).toFixed(0)}.`
                : `I found ${rows.length} recent rides. Your latest ride is ${latest.status}, from ${latest.pickup_address} to ${latest.drop_address}, fare ₹${Number(latest.fare).toFixed(0)}.`;
          }
          destination = isDriver ? "/driver-rides" : "/orders";
        } else if (containsAny(text, ["earning", "earnings", "kamai", "कमाई", "aaj kitna"])) {
          if (isDriver) {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            const { data, error } = await supabase
              .from("bookings")
              .select("driver_net_earning")
              .eq("driver_id", user.id)
              .eq("status", "completed")
              .gte("updated_at", start.toISOString())
              .lt("updated_at", end.toISOString());
            if (error) throw error;
            const total = (data ?? []).reduce(
              (sum, row) => sum + Number(row.driver_net_earning ?? 0),
              0,
            );
            reply =
              detected === "hi-IN"
                ? `Aaj ${data?.length ?? 0} rides complete hui hain. Aapki net kamai ₹${total.toFixed(0)} hai.`
                : `Today you completed ${data?.length ?? 0} rides and earned ₹${total.toFixed(0)} net.`;
            destination = "/wallet";
          } else {
            reply =
              "Customer account mein earnings summary available nahi hoti. Main aapke orders dikha sakti hoon.";
            destination = "/orders";
          }
        } else if (
          containsAny(text, [
            "book",
            "booking",
            "ride chahiye",
            "truck chahiye",
            "gaadi",
            "गाड़ी",
            "बुक",
            "बोला",
          ])
        ) {
          reply =
            detected === "hi-IN"
              ? "Booking screen khol rahi hoon. Pickup aur drop bolkar ya type karke confirm karein."
              : "Opening the booking screen. Add pickup and drop, then review before confirming.";
          destination = isDriver ? "/driver" : "/customer";
        } else if (
          containsAny(text, [
            "driver jobs",
            "available jobs",
            "offers",
            "काम",
            "नौकरी",
            "rides accept",
          ])
        ) {
          reply = "Driver home khol rahi hoon. Yahan nearby available jobs milenge.";
          destination = "/driver";
        } else if (containsAny(text, ["support", "help", "madad", "सहायता", "मदद", "complaint"])) {
          reply =
            detected === "hi-IN"
              ? "Help and Support ke liye aapke account screen par le ja rahi hoon. Wahan Help & Support kholein."
              : "Taking you to your account. Open Help & Support there to contact our team.";
          destination = "/account";
        } else if (containsAny(text, ["refer", "referral", "invite", "रेफर", "इनवाइट"])) {
          reply = "Opening your referral page. You can share your invite code from there.";
          destination = "/refer";
        } else if (containsAny(text, ["account", "profile", "प्रोफाइल", "अकाउंट"])) {
          reply = "Opening your account profile.";
          destination = "/account";
        } else if (containsAny(text, ["home", "ghar", "होम"])) {
          reply = "Opening your home screen.";
          destination = isDriver ? "/driver" : "/customer";
        } else if (containsAny(text, ["hello", "hi", "hey", "namaste", "राम राम", "नमस्ते"])) {
          reply =
            detected === "hi-IN"
              ? `Ram Ram ${profile?.name || ""}! Main ${assistantName} hoon. Wallet, rides, booking ya support mein help kar sakti hoon.`
              : `Hello ${profile?.name || ""}! I'm ${assistantName}. I can help with wallet, rides, booking and support.`;
        } else {
          reply =
            detected === "hi-IN"
              ? "Main wallet balance, ride history, aaj ki kamai, booking, referrals aur support mein help kar sakti hoon. Aap kya karna chahenge?"
              : "I can help with wallet balance, ride history, today's earnings, booking, referrals and support. What would you like?";
        }
        if (destination) {
          // Collapse Sona before changing screens so it never covers the destination page.
          setOpen(false);
          setSettingsOpen(false);
          await router.navigate({ to: destination });
        }
      } catch {
        reply =
          detected === "hi-IN"
            ? "Maaf kijiye, account data abhi load nahi ho paaya. Thodi der baad try karein."
            : "Sorry, I couldn't load that account information. Please try again.";
      } finally {
        addMessage("assistant", reply);
        say(reply, detected);
        // Keep the answer in session history and speak it, then return the screen to its normal layout.
        setOpen(false);
        setSettingsOpen(false);
        setBusy(false);
      }
    },
    [addMessage, assistantName, busy, language, profile?.name, role, router, say, user],
  );

  const onVoiceResult = useCallback(
    (transcript: string) => {
      void processCommand(transcript);
    },
    [processCommand],
  );
  const voiceIn = useVoiceInput(onVoiceResult, language);

  useEffect(() => {
    // Also dismiss Sona when navigation is triggered outside the assistant.
    setOpen(false);
    setSettingsOpen(false);
    voiceIn.stop();
  }, [pathname, voiceIn.stop]);

  useEffect(() => () => voiceIn.stop(), [voiceIn.stop]);

  const quickCommands = useMemo(
    () =>
      role === "driver"
        ? [
            "Wallet balance",
            "Today's earnings",
            "Available jobs",
            "My ride history",
            "Help & Support",
          ]
        : ["Wallet balance", "My orders", "Book a truck", "Refer a friend", "Help & Support"],
    [role],
  );

  if (!user || (role !== "customer" && role !== "driver")) return null;

  const startListening = () => {
    voiceOut.stop();
    if (!voiceIn.supported) {
      addMessage(
        "assistant",
        "Voice recognition is not available in this browser. Please use Chrome or Samsung Internet on Android.",
      );
      return;
    }
    voiceIn.start();
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${assistantName} voice assistant`}
          className="fixed bottom-[calc(9.25rem+env(safe-area-inset-bottom,0px))] right-3 z-[45] flex h-14 items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary px-4 text-primary-foreground shadow-xl ring-1 ring-primary/10 sm:bottom-[5.5rem] sm:right-5"
        >
          <Bot className="h-5 w-5" />
          <span className="text-sm font-semibold">{assistantName}</span>
        </button>
      )}
      {open && (
        <section
          aria-label={`${assistantName} assistant`}
          className="fixed inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] z-[70] mx-auto flex max-h-[min(calc(100dvh-9rem-env(safe-area-inset-bottom,0px)),620px)] w-auto max-w-md flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
        >
          <header className="flex items-center justify-between gap-2 border-b bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <Bot className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">{assistantName}</p>
                <p className="text-[11px] opacity-85">MiniPort voice co-pilot</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-primary-foreground hover:bg-white/15"
                onClick={() => setSettingsOpen((value) => !value)}
                aria-label="Assistant settings"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-primary-foreground hover:bg-white/15"
                onClick={() => {
                  voiceIn.stop();
                  voiceOut.stop();
                  setOpen(false);
                }}
                aria-label="Close assistant"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </header>
          {settingsOpen && (
            <div className="grid gap-2 border-b p-3">
              <label className="text-xs font-medium" htmlFor="sona-name">
                Assistant name / wake phrase
              </label>
              <div className="flex gap-2">
                <Input
                  id="sona-name"
                  value={nameDraft}
                  maxLength={24}
                  onChange={(event) => setNameDraft(event.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const next = nameDraft.trim().slice(0, 24) || "Sona";
                    setAssistantName(next);
                    try {
                      window.localStorage.setItem("miniport.sona.name", next);
                    } catch {
                      /* optional setting */
                    }
                  }}
                >
                  Save
                </Button>
              </div>
              <label className="text-xs font-medium" htmlFor="sona-language">
                Voice language
              </label>
              <select
                id="sona-language"
                value={language}
                onChange={(event) => {
                  const next = event.target.value as DetectedLang;
                  setLanguage(next);
                  try {
                    window.localStorage.setItem("miniport.sona.language", next);
                  } catch {
                    /* optional setting */
                  }
                }}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                {LANGUAGES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                For privacy, microphone starts only after you tap the mic. A custom wake phrase is
                checked after you start listening; background always-on listening is not supported
                by this web app.
              </p>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-muted text-foreground"}`}
              >
                {message.text}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Sona is checking your MiniPort account…
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t p-3">
            {quickCommands.map((command) => (
              <button
                key={command}
                type="button"
                onClick={() => void processCommand(command)}
                className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted"
              >
                {command}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void processCommand(input);
            }}
          >
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type or speak a command…"
              aria-label="Message Sona"
            />
            <Button
              type="button"
              size="icon"
              variant={voiceIn.listening ? "destructive" : "outline"}
              onClick={() => (voiceIn.listening ? voiceIn.stop() : startListening())}
              aria-label={voiceIn.listening ? "Stop listening" : "Start voice input"}
            >
              {voiceIn.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || busy}
              aria-label="Send command"
            >
              <Send className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => voiceOut.setMuted(!voiceOut.muted)}
              aria-label={voiceOut.muted ? "Unmute voice" : "Mute voice"}
            >
              {voiceOut.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </form>
        </section>
      )}
    </>
  );
}
