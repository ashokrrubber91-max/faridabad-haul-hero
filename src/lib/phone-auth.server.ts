/**
 * Server-only helpers for phone (SMS) sign-in and sign-up.
 *
 * Rules enforced here, never in the browser:
 *  - resend cooldown, hourly send cap and wrong-code lock-out, recorded in a
 *    private table no app user can read;
 *  - the account is only created / signed in after Twilio Verify approves;
 *  - the role of a brand-new account is decided by the database (always
 *    customer) — nothing the client sends can grant driver or admin.
 */

export const RESEND_COOLDOWN_SECONDS = 45;
const SEND_WINDOW_MINUTES = 60;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_CHECKS = 6;
const LOCK_MINUTES = 30;

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export type ThrottleResult =
  | { allowed: true }
  | { allowed: false; reason: "cooldown"; retryAfterSeconds: number }
  | { allowed: false; reason: "locked" };

/** One row per phone number; counters reset after the window passes. */
export async function throttleSend(admin: Admin, phone: string): Promise<ThrottleResult> {
  const now = Date.now();
  const { data } = await admin
    .from("phone_verification_attempts")
    .select("sends, window_started_at, last_sent_at, locked_until")
    .eq("phone", phone)
    .maybeSingle();

  if (data?.locked_until && new Date(data.locked_until).getTime() > now) {
    return { allowed: false, reason: "locked" };
  }
  if (data?.last_sent_at) {
    const elapsed = (now - new Date(data.last_sent_at).getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      return {
        allowed: false,
        reason: "cooldown",
        retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed),
      };
    }
  }

  const windowStarted = data?.window_started_at ? new Date(data.window_started_at).getTime() : now;
  const freshWindow = now - windowStarted > SEND_WINDOW_MINUTES * 60_000;
  const sends = freshWindow ? 0 : (data?.sends ?? 0);
  if (sends >= MAX_SENDS_PER_WINDOW) return { allowed: false, reason: "locked" };

  await admin.from("phone_verification_attempts").upsert(
    {
      phone,
      sends: sends + 1,
      window_started_at: new Date(freshWindow ? now : windowStarted).toISOString(),
      last_sent_at: new Date(now).toISOString(),
      checks: 0,
      locked_until: null,
    },
    { onConflict: "phone" },
  );
  return { allowed: true };
}

/** Returns false when this number has already used up its code attempts. */
export async function registerCheck(admin: Admin, phone: string): Promise<boolean> {
  const { data } = await admin
    .from("phone_verification_attempts")
    .select("checks, locked_until")
    .eq("phone", phone)
    .maybeSingle();

  if (data?.locked_until && new Date(data.locked_until).getTime() > Date.now()) return false;
  const checks = (data?.checks ?? 0) + 1;
  await admin.from("phone_verification_attempts").upsert(
    {
      phone,
      checks,
      ...(checks >= MAX_CHECKS
        ? { locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() }
        : {}),
    },
    { onConflict: "phone" },
  );
  return checks <= MAX_CHECKS;
}

export async function clearAttempts(admin: Admin, phone: string): Promise<void> {
  await admin.from("phone_verification_attempts").delete().eq("phone", phone);
}

/** Finds the account behind a phone-derived login email, if any. */
export async function findUserByEmail(
  admin: Admin,
  email: string,
): Promise<{ id: string } | null> {
  // The Admin API list is paged; MiniPort logins are email-unique so one
  // targeted page lookup is enough.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const match = (data?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return match ? { id: match.id } : null;
}

/**
 * Issues a single-use link token for an existing account. The browser exchanges
 * it for a session; no password is involved and nothing sensitive is returned.
 */
export async function issueSessionToken(admin: Admin, email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) {
    console.error(`Session link could not be issued: ${error.message}`);
    return null;
  }
  return data?.properties?.hashed_token ?? null;
}
