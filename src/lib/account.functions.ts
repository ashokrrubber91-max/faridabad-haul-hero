import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Deletes the signed-in person's own account. Authorisation is server-side and
 * scoped to auth.uid() inside `delete_my_account()`, so one account can never
 * delete another. Transactional records (completed trips, payments, payouts)
 * are kept with the personal fields removed; identity documents and the login
 * itself are deleted.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data, error } = await supabase.rpc("delete_my_account");
    if (error) throw new Error(error.message);

    const paths = ((data as { storage_paths?: unknown } | null)?.storage_paths ?? []) as unknown[];
    const objectPaths = paths.filter((p): p is string => typeof p === "string" && p.length > 0);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (objectPaths.length > 0) {
      await supabaseAdmin.storage.from("driver-kyc").remove(objectPaths);
    }
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) throw new Error(authError.message);

    return { deleted: true };
  });
