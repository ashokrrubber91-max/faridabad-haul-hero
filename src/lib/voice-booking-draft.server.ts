import type { SupabaseClient } from "@supabase/supabase-js";

type VoiceDraft = {
  pickup?: string | null;
  drop?: string | null;
  vehicle?: string | null;
  scheduledFor?: string | null;
  helperCount?: number | null;
  cargoValue?: number | null;
  notes?: string | null;
};

async function transcribe(mediaUrl: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const key = process.env.OPENAI_API_KEY;
  if (!sid || !token || !key) throw new Error("Voice draft integration is not configured");

  const media = await fetch(mediaUrl, {
    headers: { Authorization: "Basic " + btoa(`${sid}:${token}`) },
  });
  if (!media.ok) throw new Error(`Twilio media download failed [${media.status}]`);
  const blob = await media.blob();
  const form = new FormData();
  form.append("file", blob, "whatsapp-voice.ogg");
  form.append("model", "whisper-1");
  form.append("language", "hi");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Transcription failed [${response.status}]`);
  const json = await response.json();
  return String(json?.text ?? "").trim();
}

async function parseTranscript(transcript: string): Promise<VoiceDraft> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OpenAI is not configured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Extract a MiniPort truck-booking draft from Hindi or English. Return JSON with pickup, drop, vehicle (tata_ace|pickup_8ft|tata_407 or null), scheduledFor ISO timestamp or null, helperCount 0-2 or 0, cargoValue number or 0, notes string or null. Never invent addresses or times." },
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Voice parsing failed [${response.status}]`);
  const json = await response.json();
  const raw = json?.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(raw) as VoiceDraft;
}

export async function createVoiceBookingDraft(
  supabaseAdmin: SupabaseClient,
  input: { requesterPhone: string; mediaUrl: string; baseUrl: string },
) {
  const transcript = await transcribe(input.mediaUrl);
  if (!transcript) throw new Error("No speech was detected");
  const parsed = await parseTranscript(transcript);
  const { data, error } = await supabaseAdmin
    .from("voice_booking_drafts")
    .insert({
      requester_phone: input.requesterPhone,
      media_url: input.mediaUrl,
      transcript,
      parsed_data: parsed,
      status: "draft",
    })
    .select("id, public_token, expires_at, parsed_data")
    .single();
  if (error) throw new Error(error.message);
  return {
    ...data,
    url: `${input.baseUrl.replace(/\/$/, "")}/booking-draft/${data.public_token}`,
  };
}
