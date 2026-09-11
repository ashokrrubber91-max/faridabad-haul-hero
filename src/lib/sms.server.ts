/**
 * Server-only SMS delivery. Credentials are read from the server environment at
 * call time and never leave the server. When they are absent we report that
 * honestly instead of pretending a message was delivered.
 */

export interface SmsCredentials {
  sid: string;
  token: string;
  from: string;
}

export function getSmsCredentials(): SmsCredentials | null {
  const sid = process.env["TWILIO_ACCOUNT_SID"]?.trim();
  const token = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  const from = process.env["TWILIO_FROM_NUMBER"]?.trim();
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

export type SmsSendOutcome =
  | { outcome: "sent"; providerSid: string }
  | { outcome: "retry"; error: string }
  | { outcome: "failed"; error: string }
  | { outcome: "not_configured"; error: string };

function toE164(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

export async function sendSms(phone: string, body: string): Promise<SmsSendOutcome> {
  const creds = getSmsCredentials();
  if (!creds) {
    return { outcome: "not_configured", error: "SMS provider credentials are not configured" };
  }

  const to = toE164(phone);
  if (to.length < 11) return { outcome: "failed", error: `Invalid destination number: ${phone}` };

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${creds.sid}:${creds.token}`)}`,
        },
        body: new URLSearchParams({ To: to, From: creds.from, Body: body }),
      },
    );
    const payload = (await res.json().catch(() => null)) as {
      sid?: string;
      message?: string;
      code?: number;
    } | null;

    if (res.ok && payload?.sid) return { outcome: "sent", providerSid: payload.sid };

    const error = `[${res.status}] ${payload?.message ?? "SMS provider rejected the message"}`;
    // 429 / 5xx are transient; 4xx are permanent (bad number, blocked, unverified).
    if (res.status === 429 || res.status >= 500) return { outcome: "retry", error };
    return { outcome: "failed", error };
  } catch (e) {
    return { outcome: "retry", error: e instanceof Error ? e.message : "Network error" };
  }
}
