import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Mic, Square, AudioLines, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  sanitizeDriverNotes,
  validateNoteFile,
  NOTE_ATTACHMENT_LIMIT,
  NOTE_RECORDING_SECONDS,
  type NoteAttachment,
} from "@/lib/driver-notes";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  abort: () => void;
  onresult:
    | ((event: {
        results: { [index: number]: { [index: number]: { transcript: string } } };
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

export function DriverNotes({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
}: {
  value: string;
  onChange: (value: string) => void;
  attachments: NoteAttachment[];
  onAttachmentsChange: (value: NoteAttachment[]) => void;
}) {
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const latest = useRef({ attachments, onAttachmentsChange, value, onChange });
  latest.current = { attachments, onAttachmentsChange, value, onChange };
  const alive = useRef(true);
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      recognition.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const addFile = (file: File, kind: "photo" | "audio") => {
    const error = validateNoteFile(file, kind);
    if (error) {
      toast.error(error);
      return;
    }
    const current = latest.current;
    if (current.attachments.length >= NOTE_ATTACHMENT_LIMIT) {
      toast.error("Up to four attachments per booking.");
      return;
    }
    current.onAttachmentsChange([
      ...current.attachments,
      { id: crypto.randomUUID(), kind, file, url: URL.createObjectURL(file) },
    ]);
  };
  const stopRecording = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };
  const startRecording = async () => {
    if (starting || recording || listening) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Voice recording is not supported on this device.");
      return;
    }
    setStarting(true);
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        audio.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = audio;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const next = mime ? new MediaRecorder(audio, { mimeType: mime }) : new MediaRecorder(audio);
      recorder.current = next;
      const chunks: Blob[] = [];
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      next.onerror = () => {
        toast.error("Recording was interrupted. Please try again.");
        stopRecording();
      };
      next.onstop = () => {
        audio.getTracks().forEach((track) => track.stop());
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        if (!alive.current) return;
        setRecording(false);
        const blob = new Blob(chunks, { type: next.mimeType });
        if (blob.size)
          addFile(
            new File(
              [blob],
              `driver-instructions.${next.mimeType.includes("mp4") ? "m4a" : next.mimeType.includes("ogg") ? "ogg" : "webm"}`,
              { type: next.mimeType },
            ),
            "audio",
          );
      };
      next.start();
      setSeconds(0);
      setRecording(true);
      let elapsed = 0;
      timer.current = setInterval(() => {
        elapsed += 1;
        setSeconds(elapsed);
        if (elapsed >= NOTE_RECORDING_SECONDS) stopRecording();
      }, 1000);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      toast.error("Microphone access wasn’t available. You can type your notes instead.");
    } finally {
      if (alive.current) setStarting(false);
    }
  };
  const dictate = () => {
    if (listening) {
      recognition.current?.abort();
      return;
    }
    const browser = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) {
      toast.error("Dictation is not supported on this device. You can type or record a note.");
      return;
    }
    const next = new Constructor();
    recognition.current = next;
    next.lang = "hi-IN";
    next.continuous = false;
    next.interimResults = false;
    next.onresult = (event) => {
      const words = event.results[0]?.[0]?.transcript;
      if (words && alive.current)
        latest.current.onChange(
          sanitizeDriverNotes(`${latest.current.value} ${words}`).trim().slice(0, 300),
        );
    };
    next.onerror = () => {
      if (alive.current) {
        setListening(false);
        toast.error("Couldn’t hear your note. Please retry or type it.");
      }
    };
    next.onend = () => {
      if (alive.current) setListening(false);
    };
    try {
      next.start();
      setListening(true);
    } catch {
      toast.error("Couldn’t start dictation.");
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="notes">Notes for driver</Label>
        <span className="text-xs text-muted-foreground">Optional</span>
      </div>
      <Textarea
        id="notes"
        rows={3}
        value={value}
        onChange={(event) => onChange(sanitizeDriverNotes(event.target.value))}
        placeholder="2 mattresses + 1 sofa"
        maxLength={300}
        autoComplete="off"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant={listening ? "default" : "outline"}
          onClick={dictate}
          disabled={recording || starting}
          title={listening ? "Stop dictation" : "Dictate notes"}
          aria-label={listening ? "Stop dictation" : "Dictate notes"}
        >
          <Mic />
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={() => camera.current?.click()}
          disabled={attachments.length >= NOTE_ATTACHMENT_LIMIT}
          title="Take a goods photo"
          aria-label="Take a goods photo"
        >
          <Camera />
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={() => gallery.current?.click()}
          disabled={attachments.length >= NOTE_ATTACHMENT_LIMIT}
          title="Choose goods photos"
          aria-label="Choose goods photos"
        >
          <ImagePlus />
        </Button>
        <Button
          size="icon"
          variant={recording ? "destructive" : "outline"}
          onClick={() => (recording ? stopRecording() : void startRecording())}
          disabled={
            starting || listening || (!recording && attachments.length >= NOTE_ATTACHMENT_LIMIT)
          }
          title={recording ? "Stop voice note" : "Record voice note"}
          aria-label={recording ? "Stop voice note" : "Record voice note"}
        >
          {recording ? <Square /> : <AudioLines />}
        </Button>
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {recording
            ? `Recording ${seconds}s / ${NOTE_RECORDING_SECONDS}s`
            : listening
              ? "Listening…"
              : starting
                ? "Opening microphone…"
                : `${value.length}/300`}
        </span>
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) addFile(file, "photo");
          event.target.value = "";
        }}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(event) => {
          for (const file of Array.from(event.target.files ?? [])) addFile(file, "photo");
          event.target.value = "";
        }}
      />
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex min-w-0 items-center gap-3 rounded-md border p-2"
            >
              {attachment.kind === "photo" ? (
                <img
                  src={attachment.url}
                  alt="Goods attachment preview"
                  className="h-16 w-20 shrink-0 rounded object-cover"
                />
              ) : (
                <audio
                  controls
                  preload="metadata"
                  src={attachment.url}
                  className="h-10 min-w-0 flex-1"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-xs">
                {attachment.kind === "photo" ? attachment.file.name : "Voice instructions"}
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove attachment"
                onClick={() => {
                  URL.revokeObjectURL(attachment.url);
                  onAttachmentsChange(attachments.filter((row) => row.id !== attachment.id));
                }}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
