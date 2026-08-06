import { adminOp, adminSignedUrl } from "@/lib/admin.functions";

/**
 * Drop-in replacement for the browser Supabase client, for the admin console only.
 *
 * All calls are proxied to a passcode-verified server function that uses
 * privileged access, so admin reads are never filtered by the RLS policies of
 * whichever end user is signed in on the same browser.
 */

export const ADMIN_KEY = "miniport_admin_passcode";

export function getAdminPasscode(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ADMIN_KEY) ?? "";
}

export function setAdminPasscode(code: string) {
  window.localStorage.setItem(ADMIN_KEY, code);
}

export function clearAdminPasscode() {
  window.localStorage.removeItem(ADMIN_KEY);
}

type Filter = { col: string; op: "eq" | "in" | "neq"; value: unknown };
type Kind = "select" | "insert" | "update" | "upsert" | "delete";
type Result<T> = { data: T | null; error: { message: string } | null };

class AdminBuilder<T = any> implements PromiseLike<Result<T>> {
  private filters: Filter[] = [];
  private orderBy?: { col: string; asc: boolean };
  private rowLimit?: number;
  private single?: "maybe" | "one";
  private returning?: string;

  constructor(
    private table: string,
    private kind: Kind,
    private columns?: string,
    private values?: unknown,
    private onConflict?: string,
  ) {}

  eq(col: string, value: unknown) {
    this.filters.push({ col, op: "eq", value });
    return this;
  }
  neq(col: string, value: unknown) {
    this.filters.push({ col, op: "neq", value });
    return this;
  }
  in(col: string, value: unknown[]) {
    this.filters.push({ col, op: "in", value });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.rowLimit = n;
    return this;
  }
  select(cols = "*") {
    if (this.kind === "select") this.columns = cols;
    else this.returning = cols;
    return this;
  }
  maybeSingle() {
    this.single = "maybe";
    return this;
  }
  single_() {
    this.single = "one";
    return this;
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<Result<T>> {
    try {
      const res = await adminOp({
        data: {
          passcode: getAdminPasscode(),
          table: this.table,
          kind: this.kind,
          columns: this.columns,
          values: this.values,
          filters: this.filters,
          order: this.orderBy,
          limit: this.rowLimit,
          single: this.single,
          onConflict: this.onConflict,
          returning: this.returning,
        },
      });
      return { data: (res as { data: T }).data, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : "Admin request failed" } };
    }
  }
}

export const adminDb = {
  from(table: string) {
    return {
      select: (cols = "*") => new AdminBuilder(table, "select", cols),
      insert: (values: unknown) => new AdminBuilder(table, "insert", undefined, values),
      update: (values: unknown) => new AdminBuilder(table, "update", undefined, values),
      upsert: (values: unknown, opts?: { onConflict?: string }) =>
        new AdminBuilder(table, "upsert", undefined, values, opts?.onConflict),
      delete: () => new AdminBuilder(table, "delete"),
    };
  },
  async signedUrl(bucket: string, path: string) {
    try {
      const res = await adminSignedUrl({ data: { passcode: getAdminPasscode(), bucket, path } });
      return { data: res, error: null as null | { message: string } };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : "Could not open document" } };
    }
  },
};

/** Verifies the passcode against the server before unlocking the console. */
export async function verifyAdminPasscode(code: string): Promise<boolean> {
  try {
    await adminOp({
      data: { passcode: code, table: "profiles", kind: "select", columns: "id", limit: 1 },
    });
    return true;
  } catch {
    return false;
  }
}
