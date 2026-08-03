import { useCallback, useEffect, useRef, useState } from "react";

export type DetectedLang = "hi-IN" | "en-IN";

/** Devanagari script => Hindi, otherwise default to Indian English. */
export function detectLang(text: string): DetectedLang {
  return /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isVoiceInputSupported() {
  return getSpeechRecognitionCtor() !== null;
}

export function isVoiceOutputSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Hook: mic-based speech-to-text with auto language detection (hi-IN default listen locale, falls back). */
export function useVoiceInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "hi-IN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) onResult(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [onResult]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { listening, start, stop, supported: isVoiceInputSupported() };
}

/** Hook: text-to-speech with female-voice preference and Indian locale matching. */
export function useVoiceOutput() {
  const [muted, setMuted] = useState(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!isVoiceOutputSupported()) return;
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const speak = useCallback((text: string, lang: DetectedLang) => {
    if (muted || !isVoiceOutputSupported() || !text.trim()) return;
    const plain = text.replace(/[*_`#>\-]/g, " ").replace(/\s+/g, " ").trim();
    if (!plain) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(plain);
    const voices = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const preferredLocales = lang === "hi-IN" ? ["hi-IN", "en-IN"] : ["en-IN", "hi-IN"];
    let chosen: SpeechSynthesisVoice | undefined;
    for (const locale of preferredLocales) {
      chosen = voices.find(
        (v) => v.lang?.toLowerCase() === locale.toLowerCase() && /female/i.test(v.name),
      );
      if (chosen) break;
    }
    if (!chosen) {
      for (const locale of preferredLocales) {
        chosen = voices.find((v) => v.lang?.toLowerCase() === locale.toLowerCase());
        if (chosen) break;
      }
    }
    if (!chosen) {
      chosen = voices.find((v) => /female/i.test(v.name));
    }
    if (chosen) utter.voice = chosen;
    utter.lang = chosen?.lang ?? lang;
    utter.pitch = 1;
    utter.rate = 1;
    window.speechSynthesis.speak(utter);
  }, [muted]);

  const stop = useCallback(() => {
    if (isVoiceOutputSupported()) window.speechSynthesis.cancel();
  }, []);

  return { speak, stop, muted, setMuted, supported: isVoiceOutputSupported() };
}
