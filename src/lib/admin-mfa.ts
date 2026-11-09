import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only server functions require a session that completed two-step
 * verification (Supabase authenticator assurance level "aal2"). A stolen or
 * guessed admin password alone is not enough.
 */
export const requireAdminMfa = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const aal = (context as unknown as { claims?: { aal?: string } }).claims?.aal;
    if (aal !== "aal2") {
      throw new Error("Two-step verification required. Sign in again at the team sign-in page.");
    }
    return next();
  });
