import { supabase } from "@/integrations/supabase/client";

/**
 * Effective versions of the published policies. Bumping a value here is what
 * triggers the in-app re-consent card — nothing else re-asks on every login.
 */
export const TERMS_VERSION = "2026-09-14";
export const PRIVACY_VERSION = "2026-09-14";

export type ConsentSource = "signup" | "reconsent" | "account";

/**
 * Records acceptance server-side (account id, versions, timestamp, source).
 * Never throws: a recording hiccup must not strand a freshly verified sign-up.
 */
export async function recordConsent(source: ConsentSource): Promise<boolean> {
  const { error } = await supabase.rpc("record_consent", {
    _terms_version: TERMS_VERSION,
    _privacy_version: PRIVACY_VERSION,
    _source: source,
  });
  return !error;
}

/** True when this account has already accepted the current policy versions. */
export async function hasCurrentConsent(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_consents")
    .select("id")
    .eq("user_id", userId)
    .eq("terms_version", TERMS_VERSION)
    .eq("privacy_version", PRIVACY_VERSION)
    .limit(1);
  if (error) return true; // fail open: never block the app on a read error
  return (data ?? []).length > 0;
}
