/**
 * Server-only Firebase Cloud Messaging (HTTP v1) helpers.
 * Signs a service-account JWT with WebCrypto so it works on the edge runtime.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function getServiceAccount(): ServiceAccount | null {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getWebPushConfig(): { config: Record<string, string>; vapidKey: string } | null {
  const raw = process.env["FIREBASE_WEB_CONFIG_JSON"];
  const vapidKey = process.env["FIREBASE_VAPID_PUBLIC_KEY"];
  if (!raw || !vapidKey) return null;
  try {
    const config = JSON.parse(raw) as Record<string, string>;
    if (!config.apiKey || !config.projectId || !config.messagingSenderId || !config.appId) return null;
    return { config, vapidKey };
  } catch {
    return null;
  }
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64UrlEncode(
    JSON.stringify(claim),
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description ?? "Could not authenticate with the notification service");
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + 3500 * 1000 };
  return body.access_token;
}

export interface PushMessage {
  title: string;
  body: string;
  link?: string;
  data?: Record<string, string>;
}

export interface PushResult {
  sent: number;
  failed: number;
  invalidTokens: string[];
}

export async function sendPushToTokens(tokens: string[], message: PushMessage): Promise<PushResult> {
  const account = getServiceAccount();
  const result: PushResult = { sent: 0, failed: 0, invalidTokens: [] };
  if (!account || tokens.length === 0) return result;

  const accessToken = await getAccessToken(account);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;

  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title, body: message.body },
              data: { ...(message.data ?? {}), link: message.link ?? "/driver" },
              webpush: {
                notification: {
                  title: message.title,
                  body: message.body,
                  icon: "/favicon.ico",
                  requireInteraction: true,
                  tag: message.data?.bookingId ?? "miniport-alert",
                },
                fcm_options: { link: message.link ?? "/driver" },
              },
              android: { priority: "high" },
            },
          }),
        });
        if (res.ok) {
          result.sent += 1;
          return;
        }
        result.failed += 1;
        const detail = (await res.json().catch(() => null)) as
          | { error?: { status?: string } }
          | null;
        const status = detail?.error?.status;
        if (res.status === 404 || status === "NOT_FOUND" || status === "INVALID_ARGUMENT") {
          result.invalidTokens.push(token);
        }
      } catch {
        result.failed += 1;
      }
    }),
  );

  return result;
}
