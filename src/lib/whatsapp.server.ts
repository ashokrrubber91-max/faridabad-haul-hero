/**
 * Server-only Twilio WhatsApp transport.
 *
 * Credentials are read from the server environment at call time and never reach
 * the browser. Two setups are supported, whichever is configured:
 *   1. The Twilio connector (gateway): LOVABLE_API_KEY + TWILIO_API_KEY.
 *   2. Direct Twilio credentials: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.
 * The WhatsApp sender comes from TWILIO_WHATSAPP_FROM (e.g. whatsapp:+1415...).
 *
 * Inbound webhook signatures are verified with TWILIO_AUTH_TOKEN — Twilio signs
 * with the account auth token, so without it we refuse callbacks instead of
 * trusting unauthenticated input.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

type Transport =
  | { kind: "gateway"; lovableKey: string; connectionKey: string }
  | { kind: "direct"; sid: string; token: string };

function transport(): Transport | null {
  const lovableKey = process.env["LOVABLE_API_KEY"]?.trim();
  const connectionKey = process.env["TWILIO_API_KEY"]?.trim();
  if (lovableKey && connectionKey) return { kind: "gateway", lovableKey, connectionKey };

  const sid = process.env["TWILIO_ACCOUNT_SID"]?.trim();
  const token = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  if (sid && token) return { kind: "direct", sid, token };
  return null;
}

export function whatsappFrom(): string | null {
  const from = process.env["TWILIO_WHATSAPP_FROM"]?.trim();
  if (!from) return null;
  return from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
}

export function isWhatsAppConfigured(): boolean {
  return transport() !== null && whatsappFrom() !== null;
}

export function isWebhookVerifiable(): boolean {
  return !!process.env["TWILIO_AUTH_TOKEN"]?.trim();
}

/** Normalises any WhatsApp address to the bare E.164 digits (no `whatsapp:`). */
export function bareE164(waAddress: string): string {
  const raw = waAddress.replace(/^whatsapp:/i, "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? `+${digits}` : "";
}

/** Last 10 digits — how MiniPort stores Indian mobile numbers on profiles. */
export function last10(waAddress: string): string {
  const digits = bareE164(waAddress).replace(/[^0-9]/g, "");
  return digits.slice(-10);
}

export type WhatsAppSendResult =
  | { outcome: "sent"; providerSid: string }
  | { outcome: "failed"; error: string }
  | { outcome: "not_configured"; error: string };

export async function sendWhatsApp(toPhone: string, body: string): Promise<WhatsAppSendResult> {
  const t = transport();
  const from = whatsappFrom();
  if (!t || !from) {
    return {
      outcome: "not_configured",
      error: "Twilio WhatsApp credentials or sender number are not configured",
    };
  }

  const to = `whatsapp:${bareE164(toPhone)}`;
  const form = new URLSearchParams({ To: to, From: from, Body: body.slice(0, 1500) });

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  let url: string;
  if (t.kind === "gateway") {
    url = `${GATEWAY_URL}/Messages.json`;
    headers["Authorization"] = `Bearer ${t.lovableKey}`;
    headers["X-Connection-Api-Key"] = t.connectionKey;
  } else {
    url = `https://api.twilio.com/2010-04-01/Accounts/${t.sid}/Messages.json`;
    headers["Authorization"] = `Basic ${btoa(`${t.sid}:${t.token}`)}`;
  }

  try {
    const res = await fetch(url, { method: "POST", headers, body: form });
    const payload = (await res.json().catch(() => null)) as {
      sid?: string;
      message?: string;
    } | null;
    if (res.ok && payload?.sid) return { outcome: "sent", providerSid: payload.sid };
    const error = `[${res.status}] ${payload?.message ?? "WhatsApp provider rejected the message"}`;
    console.error(`WhatsApp send failed ${error}`);
    return { outcome: "failed", error };
  } catch (e) {
    return { outcome: "failed", error: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * Twilio signs `X-Twilio-Signature` as base64(HMAC-SHA1(authToken,
 * url + sorted(key + value for every POST parameter))). Timing-safe compare.
 */
export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
): Promise<boolean> {
  const token = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  if (!token || !signature) return false;

  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k] ?? ""}`)
      .join("");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
