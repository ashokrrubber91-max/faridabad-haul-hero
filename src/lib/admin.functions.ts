import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Approves or rejects a driver application. The decision is taken on the server
 * after verifying the caller really holds the admin role, so a tampered client
 * can never verify a driver.
 */
export const reviewDriverKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        driverId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().trim().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // The decision is written by an admin-only database routine: the review
    // columns are not directly writable by any signed-in user, so a tampered
    // client cannot approve a driver even with a valid session.
    const { error } = await context.supabase.rpc("review_driver_kyc", {
      _driver_id: data.driverId,
      _decision: data.decision,
      _reason: data.reason?.trim() || undefined,
    });
    if (error) throw new Error(error.message);

    return { ok: true, status: data.decision };
  });

/**
 * Tells the signed-in user whether the platform already has a team account.
 * Used only to decide whether the one-time setup path should be offered.
 */
export const getAdminSetupState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_exists");
    if (error) throw new Error(error.message);
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { adminExists: Boolean(data), isAdmin: Boolean(isAdmin) };
  });

/**
 * One-time bootstrap: the first signed-in person can take ownership of the
 * control room. The database refuses this the moment any admin exists, so it
 * can never be used to escalate a normal customer later.
 */
export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("claim_first_admin", { _user_id: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
