/**
 * Turns a free-text WhatsApp message (English / Hindi / Hinglish) into
 * structured MiniPort data. Server-only: it uses the Lovable AI gateway key.
 *
 * Nothing here invents booking facts — any field the message does not contain
 * comes back null so the assistant can ask for it instead of guessing.
 */

import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

export type ParsedWhatsApp = {
  intent:
    "booking_request" | "confirm" | "cancel" | "edit" | "task" | "status_query" | "help" | "other";
  pickup_address: string | null;
  drop_address: string | null;
  schedule_text: string | null;
  scheduled_at: string | null;
  material: string | null;
  quantity: string | null;
  weight_kg: number | null;
  dimensions: string | null;
  vehicle_hint: string | null;
  instructions: string | null;
  task_title: string | null;
  task_details: string | null;
  task_priority: "low" | "normal" | "high" | null;
  language: string | null;
};

const EMPTY: ParsedWhatsApp = {
  intent: "other",
  pickup_address: null,
  drop_address: null,
  schedule_text: null,
  scheduled_at: null,
  material: null,
  quantity: null,
  weight_kg: null,
  dimensions: null,
  vehicle_hint: null,
  instructions: null,
  task_title: null,
  task_details: null,
  task_priority: null,
  language: null,
};

const CONFIRM_WORDS = /\b(confirm|confirmed|yes|ok|okay|haan|han|ha|theek|thik|sahi|book)\b/i;
const CANCEL_WORDS = /\b(cancel|cancelled|no|nahi|mat|rok|stop)\b/i;

/** Cheap, provider-free reading of a one-word confirm/cancel reply. */
export function quickReplyIntent(body: string): "confirm" | "cancel" | null {
  const t = body.trim();
  if (t.length > 25) return null;
  if (CANCEL_WORDS.test(t)) return "cancel";
  if (CONFIRM_WORDS.test(t)) return "confirm";
  return null;
}

export async function parseWhatsAppMessage(
  body: string,
  role: "customer" | "driver" | "admin",
  existingDraft: Record<string, unknown> | null,
  nowIso: string,
): Promise<ParsedWhatsApp> {
  const key = process.env["LOVABLE_API_KEY"]?.trim();
  if (!key) return { ...EMPTY };

  const system = `You extract structured data from WhatsApp messages sent to MiniPort, a mini-truck booking service in Faridabad, India. Messages may be English, Hindi (Devanagari) or Hinglish.

Sender role: ${role}
Current server time (IST offset +05:30): ${nowIso}
${existingDraft ? `Existing booking draft being edited (merge new details into it): ${JSON.stringify(existingDraft)}` : "No existing booking draft."}

Return ONLY a JSON object with exactly these keys:
{"intent":"booking_request|confirm|cancel|edit|task|status_query|help|other","pickup_address":string|null,"drop_address":string|null,"schedule_text":string|null,"scheduled_at":ISO-8601 string|null,"material":string|null,"quantity":string|null,"weight_kg":number|null,"dimensions":string|null,"vehicle_hint":string|null,"instructions":string|null,"task_title":string|null,"task_details":string|null,"task_priority":"low|normal|high"|null,"language":string|null}

Rules:
- NEVER invent an address, date, time, weight or material that is not in the message. Use null.
- Only resolve relative dates ("kal", "tomorrow", "aaj") against the server time given above.
- For a customer describing goods movement use intent "booking_request" (or "edit" when correcting an existing draft).
- For a driver or admin describing work to remember or do, use intent "task" and fill task_title / task_details.
- Asking about an existing trip, earnings or job list is "status_query".
- Output raw JSON. No markdown fences, no commentary.`;

  try {
    const gateway = createLovableAiGatewayProvider(key);
    const { text } = await generateText({
      model: gateway("google/gemini-3.5-flash"),
      system,
      messages: [{ role: "user", content: body.slice(0, 2000) }],
    });
    const json = text.replace(/```json|```/gi, "").trim();
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    if (start < 0 || end <= start) return { ...EMPTY };
    const parsed = JSON.parse(json.slice(start, end + 1)) as Partial<ParsedWhatsApp>;
    return {
      ...EMPTY,
      ...parsed,
      weight_kg:
        typeof parsed.weight_kg === "number" && Number.isFinite(parsed.weight_kg)
          ? parsed.weight_kg
          : null,
    };
  } catch (e) {
    console.error("[whatsapp-ai] parse failed:", e);
    return { ...EMPTY };
  }
}
