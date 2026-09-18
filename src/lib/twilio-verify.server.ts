/**
 * Server-only Twilio Verify access.
 *
 * Credentials are read from the server environment at call time and never
 * leave the server: no code is generated, stored or returned by MiniPort —
 * Twilio Verify owns the code entirely.
 *
 * Two setups are supported, whichever is configured:
 *  1. The Twilio connector (gateway): LOVABLE_API_KEY + TWILIO_API_KEY.
 *  2. Direct Twilio credentials: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.
 * The Verify service is taken from TWILIO_VERIFY_SERVICE_SID when set,
 * otherwise the account's first Verify service is discovered once.
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

export function isVerifyConfigured(): boolean {
  return transport() !== null;
}

async function twilioFetch(
  t: Transport,
  path: string,
  init?: { method?: string; body?: URLSearchParams },
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {};
  if (init?.body) headers["content-type"] = "application/x-www-form-urlencoded";

  let url: string;
  if (t.kind === "gateway") {
    url = `${GATEWAY_URL}${path}`;
    headers["Authorization"] = `Bearer ${t.lovableKey}`;
    headers["X-Connection-Api-Key"] = t.connectionKey;
  } else {
    url = `https://verify.twilio.com${path.replace(/^\/verify/, "")}`;
    headers["Authorization"] = `Basic ${btoa(`${t.sid}:${t.token}`)}`;
  }

  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body ? { body: init.body } : {}),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, json };
}

let cachedServiceSid: string | null = null;

async function serviceSid(t: Transport): Promise<string | null> {
  const configured = process.env["TWILIO_VERIFY_SERVICE_SID"]?.trim();
  if (configured) return configured;
  if (cachedServiceSid) return cachedServiceSid;
  const { ok, json } = await twilioFetch(t, "/verify/v2/Services?PageSize=1");
  if (!ok || !json) return null;
  const services = (json["services"] as Array<{ sid?: string }> | undefined) ?? [];
  cachedServiceSid = services[0]?.sid ?? null;
  return cachedServiceSid;
}

export type VerifyOutcome =
  | { outcome: "sent" }
  | { outcome: "approved" }
  | { outcome: "invalid_code" }
  | { outcome: "expired" }
  | { outcome: "too_many_attempts" }
  | { outcome: "not_configured" }
  | { outcome: "provider_error" };

/** Starts an SMS verification for an E.164 number. Never returns the code. */
export async function startVerification(e164: string): Promise<VerifyOutcome> {
  const t = transport();
  if (!t) return { outcome: "not_configured" };
  const sid = await serviceSid(t);
  if (!sid) return { outcome: "not_configured" };

  const { ok, status, json } = await twilioFetch(t, `/verify/v2/Services/${sid}/Verifications`, {
    method: "POST",
    body: new URLSearchParams({ To: e164, Channel: "sms" }),
  });
  if (ok) return { outcome: "sent" };

  const code = Number(json?.["code"] ?? 0);
  // 60203: max send attempts reached. 429: provider rate limit.
  if (code === 60203 || status === 429) return { outcome: "too_many_attempts" };
  console.error(`Twilio Verify start failed [${status}] code ${code}`);
  return { outcome: "provider_error" };
}

/** Checks a code with Twilio. The code is never logged or echoed back. */
export async function checkVerification(e164: string, code: string): Promise<VerifyOutcome> {
  const t = transport();
  if (!t) return { outcome: "not_configured" };
  const sid = await serviceSid(t);
  if (!sid) return { outcome: "not_configured" };

  const { ok, status, json } = await twilioFetch(
    t,
    `/verify/v2/Services/${sid}/VerificationCheck`,
    { method: "POST", body: new URLSearchParams({ To: e164, Code: code }) },
  );

  if (ok) {
    const state = String(json?.["status"] ?? "");
    if (state === "approved") return { outcome: "approved" };
    return { outcome: "invalid_code" };
  }

  const errorCode = Number(json?.["code"] ?? 0);
  // 20404: no pending verification (never sent, already used, or expired).
  if (errorCode === 20404) return { outcome: "expired" };
  if (errorCode === 60202 || status === 429) return { outcome: "too_many_attempts" };
  console.error(`Twilio Verify check failed [${status}] code ${errorCode}`);
  return { outcome: "provider_error" };
}
