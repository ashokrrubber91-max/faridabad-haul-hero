/**
 * Loose row shape for admin/ops tables that render heterogeneous database rows.
 * Kept in one place so the rest of the codebase stays free of inline `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRow = Record<string, any>;
