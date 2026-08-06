/**
 * Server-only admin data access.
 *
 * The admin console is passcode gated. Reads/writes MUST NOT go through the
 * browser Supabase client, because RLS would scope them to whichever end user
 * happens to be signed in (that caused drivers to be classified as customers,
 * the KYC queue to look empty, and pending counts to read 0).
 */

export type AdminFilter = { col: string; op: "eq" | "in" | "neq"; value: unknown };

export type AdminOp = {
  table: string;
  kind: "select" | "insert" | "update" | "upsert" | "delete";
  columns?: string;
  values?: unknown;
  filters?: AdminFilter[];
  order?: { col: string; asc: boolean };
  limit?: number;
  single?: "maybe" | "one";
  onConflict?: string;
  returning?: string;
};

const READ_TABLES = new Set([
  "bookings",
  "profiles",
  "user_roles",
  "wallet_accounts",
  "wallet_transactions",
  "sms_logs",
  "driver_incentive_config",
  "driver_incentive_earnings",
  "coupons",
  "driver_kyc",
  "driver_bank_accounts",
  "withdrawal_requests",
  "payments",
]);

const WRITE_TABLES = new Set([
  "bookings",
  "profiles",
  "wallet_accounts",
  "wallet_transactions",
  "sms_logs",
  "driver_incentive_config",
  "coupons",
  "driver_kyc",
  "withdrawal_requests",
]);

export function assertAdminPasscode(passcode: string) {
  const expected = process.env["ADMIN_PASSCODE"] ?? "miniport2026";
  if (passcode !== expected) throw new Error("Admin authentication failed");
}

export async function runAdminOp(op: AdminOp) {
  const allowed = op.kind === "select" ? READ_TABLES : WRITE_TABLES;
  if (!allowed.has(op.table)) throw new Error(`Table not available to admin console: ${op.table}`);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const table = supabaseAdmin.from(op.table as never) as any;

  let q: any;
  if (op.kind === "select") {
    q = table.select(op.columns ?? "*");
  } else if (op.kind === "insert") {
    q = table.insert(op.values as never);
  } else if (op.kind === "upsert") {
    q = table.upsert(op.values as never, op.onConflict ? { onConflict: op.onConflict } : undefined);
  } else if (op.kind === "update") {
    q = table.update(op.values as never);
  } else {
    q = table.delete();
  }

  for (const f of op.filters ?? []) {
    if (f.op === "in") q = q.in(f.col, f.value as unknown[]);
    else if (f.op === "neq") q = q.neq(f.col, f.value);
    else q = q.eq(f.col, f.value);
  }

  if (op.kind === "select") {
    if (op.order) q = q.order(op.order.col, { ascending: op.order.asc });
    if (op.limit) q = q.limit(op.limit);
  } else if (op.returning) {
    q = q.select(op.returning);
  }

  if (op.single === "maybe") q = q.maybeSingle();
  else if (op.single === "one") q = q.single();

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { data: data ?? null };
}

export async function createAdminSignedUrl(bucket: string, path: string) {
  if (bucket !== "driver-kyc" && bucket !== "delivery-proof") throw new Error("Unknown bucket");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data) throw new Error(error?.message ?? "Could not sign document URL");
  return { url: data.signedUrl };
}
