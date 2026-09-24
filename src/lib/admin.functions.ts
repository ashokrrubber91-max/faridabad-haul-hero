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


export const adminCreateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      name: z.string().trim().min(2).max(80),
      phone: z.string().regex(/^\d{10}$/, "Enter a valid 10-digit Indian mobile number"),
      password: z.string().min(8).max(128),
      role: z.enum(["customer", "driver", "staff"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admin access required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = phoneToEmailForAdmin(data.phone);
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name: data.name, created_by_admin: true },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Could not create account");

    const uid = created.user.id;
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ name: data.name, phone: data.phone })
      .eq("id", uid);
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error(profileError.message);
    }

    const { error: roleDeleteError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    if (roleDeleteError) throw new Error(roleDeleteError.message);
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: uid, role: data.role as never });
    if (roleError) throw new Error(roleError.message);

    if (data.role === "driver") {
      await supabaseAdmin.from("driver_profiles").upsert({ user_id: uid }, { onConflict: "user_id" });
    }

    await supabaseAdmin.from("account_admin_audit").insert({
      actor_id: context.userId,
      target_user_id: uid,
      action: "create",
      role: data.role,
      metadata: { name: data.name, phone: data.phone },
    });

    return { ok: true, userId: uid, email };
  });

export const adminUpdateAccountStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      userId: z.string().uuid(),
      active: z.boolean(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admin access required");
    if (data.userId === context.userId && !data.active) throw new Error("You cannot suspend your own admin account");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.active ? "none" : "876000h",
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("account_admin_audit").insert({
      actor_id: context.userId,
      target_user_id: data.userId,
      action: data.active ? "reactivate" : "suspend",
    });
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      userId: z.string().uuid(),
      password: z.string().min(8).max(128),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admin access required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("account_admin_audit").insert({
      actor_id: context.userId,
      target_user_id: data.userId,
      action: "reset_password",
    });
    return { ok: true };
  });

export const adminListAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admin access required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(error.message);

    const ids = users.users.map((u) => u.id);
    const [{ data: profiles }, { data: roles }, { data: audits }] = await Promise.all([
      ids.length ? supabaseAdmin.from("profiles").select("id,name,phone,active_mode,is_online,kyc_status,created_at").in("id", ids) : Promise.resolve({ data: [] }),
      ids.length ? supabaseAdmin.from("user_roles").select("user_id,role").in("user_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? supabaseAdmin.from("account_admin_audit").select("target_user_id,action,created_at").in("target_user_id", ids).order("created_at", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
    ]);

    return {
      accounts: users.users.map((u) => {
        const p = (profiles ?? []).find((x) => x.id === u.id);
        const rs = (roles ?? []).filter((x) => x.user_id === u.id).map((x) => String(x.role));
        const lastAudit = (audits ?? []).find((x) => x.target_user_id === u.id);
        return {
          id: u.id,
          name: p?.name ?? String(u.user_metadata?.name ?? ""),
          phone: p?.phone ?? "",
          email: u.email ?? "",
          roles: rs,
          active: !u.banned_until || new Date(u.banned_until) < new Date(),
          createdAt: u.created_at,
          lastSignIn: u.last_sign_in_at,
          lastAction: lastAudit?.action ?? null,
          lastActionAt: lastAudit?.created_at ?? null,
        };
      }),
    };
  });

function phoneToEmailForAdmin(phone: string) {
  return `${phone}@miniport.app`;
}
