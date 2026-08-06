import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const filterSchema = z.object({
  col: z.string().min(1).max(64),
  op: z.enum(["eq", "in", "neq"]),
  value: z.any(),
});

const opSchema = z.object({
  passcode: z.string().min(1).max(200),
  table: z.string().min(1).max(64),
  kind: z.enum(["select", "insert", "update", "upsert", "delete"]),
  columns: z.string().max(2000).optional(),
  values: z.any().optional(),
  filters: z.array(filterSchema).max(10).optional(),
  order: z.object({ col: z.string().max(64), asc: z.boolean() }).optional(),
  limit: z.number().int().positive().max(2000).optional(),
  single: z.enum(["maybe", "one"]).optional(),
  onConflict: z.string().max(200).optional(),
  returning: z.string().max(2000).optional(),
});

/** Single entry point used by the passcode-gated admin console. */
export const adminOp = createServerFn({ method: "POST" })
  .inputValidator((input) => opSchema.parse(input))
  .handler(async ({ data }) => {
    const { assertAdminPasscode, runAdminOp } = await import("@/lib/admin.server");
    const { passcode, ...op } = data;
    assertAdminPasscode(passcode);
    return runAdminOp(op as never);
  });

export const adminSignedUrl = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        passcode: z.string().min(1).max(200),
        bucket: z.string().min(1).max(64),
        path: z.string().min(1).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { assertAdminPasscode, createAdminSignedUrl } = await import("@/lib/admin.server");
    assertAdminPasscode(data.passcode);
    return createAdminSignedUrl(data.bucket, data.path);
  });
