/**
 * Deterministic, on-device parser for spoken ride requests ("Sector 15 se NIT
 * tak 600 kg Tata Ace", "from Ballabgarh to Sector 74, pickup 8ft"). No AI call,
 * so it costs no credits and never sends the customer's voice off the device.
 */

export type VoiceVehicleId = "tata_ace" | "pickup_8ft" | "tata_407" | "bike_delivery";

export type ParsedRideCommand = {
  pickup: string | null;
  drop: string | null;
  weightKg: number | null;
  vehicle: VoiceVehicleId | null;
};

export const MAX_VOICE_WEIGHT_KG = 50_000;

const VEHICLE_PATTERNS: Array<[VoiceVehicleId, RegExp]> = [
  ["tata_407", /\b(?:tata\s*)?(?:4\s*0\s*7|four\s*o\s*seven|चार\s*सौ\s*सात)\b/i],
  [
    "pickup_8ft",
    /\b(?:pick\s*-?\s*up|पिकअप)(?:\s*(?:8|eight|आठ)\s*(?:ft|feet|foot|फ़ुट|फुट))?\b|\b(?:8|eight)\s*(?:ft|feet|foot)\b/i,
  ],
  ["tata_ace", /\b(?:tata\s*)?ace\b|chhota\s*hathi|छोटा\s*हाथी|टाटा\s*ऐस/i],
  ["bike_delivery", /\b(?:bike|motor\s*cycle|two\s*wheeler|बाइक)(?:\s*delivery)?\b/i],
];

const WEIGHT_RE =
  /(\d+(?:[.,]\d+)?)\s*(kgs?|kilo(?:gram)?s?|किलो(?:ग्राम)?|tonnes?|tons?|टन|quintals?|क्विंटल)/i;

/** Words that should not stay attached to a spoken address. */
const FILLER_RE =
  /\b(?:please|book|a|an|the|ride|truck|gaadi|gadi|chahiye|bhejo|karo|kar\s*do|mujhe|i\s*want|need|send|me|ek|for|with|of|load|goods|saman|samaan)\b/gi;

function cleanPlace(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(WEIGHT_RE, " ")
    .replace(FILLER_RE, " ")
    .replace(/\b(?:pickup|drop|location|address)\b/gi, " ")
    .replace(/[,.;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 2 ? text.slice(0, 200) : null;
}

function stripVehicles(text: string): string {
  let out = text;
  for (const [, re] of VEHICLE_PATTERNS) out = out.replace(new RegExp(re.source, "gi"), " ");
  return out;
}

export function parseVehicle(text: string): VoiceVehicleId | null {
  for (const [id, re] of VEHICLE_PATTERNS) if (re.test(text)) return id;
  return null;
}

export function parseWeightKg(text: string): number | null {
  const m = WEIGHT_RE.exec(text);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2].toLowerCase();
  const kg = /ton|टन/.test(unit) ? value * 1000 : /quintal|क्विंटल/.test(unit) ? value * 100 : value;
  return kg > MAX_VOICE_WEIGHT_KG ? null : Math.round(kg * 10) / 10;
}

export function parseRideCommand(input: string): ParsedRideCommand {
  const text = input.replace(/\s+/g, " ").trim();
  const weightKg = parseWeightKg(text);
  const vehicle = parseVehicle(text);
  const body = stripVehicles(text).replace(WEIGHT_RE, " ");

  let pickup: string | null = null;
  let drop: string | null = null;

  // "pickup X drop Y"
  const labelled = /pick\s*-?\s*up\s+(?:from\s+)?(.+?)\s+drop(?:\s*off)?\s+(?:at\s+|to\s+)?(.+)/i.exec(
    body,
  );
  // "from X to Y"
  const fromTo = /\bfrom\s+(.+?)\s+(?:to|till|until)\s+(.+)/i.exec(body);
  // Hinglish / Hindi: "X se Y tak|ko|jana hai"
  const seTak = /(.+?)\s+(?:se|से)\s+(.+?)(?:\s+(?:tak|तक|ko|को|jana|जाना|le\s*jana|bhejna).*)?$/i.exec(
    body,
  );
  // Plain "X to Y"
  const plainTo = /(.+?)\s+to\s+(.+)/i.exec(body);

  const match = labelled ?? fromTo ?? seTak ?? plainTo;
  if (match) {
    pickup = cleanPlace(match[1]);
    drop = cleanPlace(match[2]);
  }
  return { pickup, drop, weightKg, vehicle };
}

/** Smallest active vehicle whose payload fits the cargo. */
export function vehicleForWeight(
  weightKg: number,
  vehicles: Array<{ id: string; payload_kg: number | null; weight_limit_kg: number | null }>,
): string | null {
  const fitting = vehicles
    .map((v) => ({ id: v.id, cap: Number(v.payload_kg ?? v.weight_limit_kg ?? 0) }))
    .filter((v) => v.cap >= weightKg)
    .sort((a, b) => a.cap - b.cap);
  return fitting[0]?.id ?? null;
}

/** Keep searches inside the service area when the customer just says "Sector 15". */
export function serviceAreaQuery(place: string): string {
  return /faridabad|फरीदाबाद/i.test(place) ? place : `${place}, Faridabad`;
}
