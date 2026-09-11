import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Drains the outbound message queue. Jobs are claimed atomically in the
 * database (SKIP LOCKED), so two concurrent runs can never send the same
 * message twice, delivered messages are never re-sent, transient failures back
 * off and retry up to their attempt limit, and permanent failures stay visible
 * as failed. Missing provider credentials mark the row "not_configured" — the
 * booking itself is never affected.
 */
export const processSmsQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ limit: z.number().int().min(1).max(50).default(20) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms, getSmsCredentials } = await import("@/lib/sms.server");

    const { data: jobs, error } = await supabaseAdmin.rpc("claim_sms_jobs", {
      _limit: data.limit,
    });
    if (error) throw new Error(error.message);

    const claimed = jobs ?? [];
    const summary = { claimed: claimed.length, sent: 0, retrying: 0, failed: 0, skipped: 0 };
    if (claimed.length === 0) {
      return { ...summary, providerConfigured: !!getSmsCredentials() };
    }

    for (const job of claimed) {
      const result = await sendSms(job.phone, job.body);
      const { error: completeError } = await supabaseAdmin.rpc("complete_sms_job", {
        _id: job.id,
        _outcome: result.outcome,
        _provider_sid: result.outcome === "sent" ? result.providerSid : null,
        _error: result.outcome === "sent" ? null : result.error,
      });
      if (completeError) throw new Error(completeError.message);

      if (result.outcome === "sent") summary.sent += 1;
      else if (result.outcome === "retry") summary.retrying += 1;
      else if (result.outcome === "failed") summary.failed += 1;
      else summary.skipped += 1;
    }

    return { ...summary, providerConfigured: !!getSmsCredentials() };
  });

/**
 * Closes ride requests whose validity window has passed. The database function
 * is trusted-server-only, so the driver app calls it through here instead of
 * holding a direct execute grant.
 */
export const sweepStaleBookings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("expire_stale_bookings");
    if (error) throw new Error(error.message);
    return { expired: data ?? 0 };
  });
