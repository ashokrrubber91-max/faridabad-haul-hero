import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * One sign-out path for every role (customer, driver, admin).
 * Order matters: cancel in-flight queries first so nothing 401s against a
 * cleared session, drop cached protected data, end the Supabase session, then
 * replace history so Back cannot restore an admin/driver screen.
 */
export async function signOutEverywhere(qc: QueryClient, redirectTo = "/auth") {
  try {
    await qc.cancelQueries();
  } catch {
    // cancellation is best-effort; never block the sign-out
  }
  qc.clear();
  await supabase.auth.signOut();
  window.location.replace(redirectTo);
}
