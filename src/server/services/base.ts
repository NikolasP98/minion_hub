import type { Db } from '$server/db/client';

export interface TenantContext {
  db: Db;
  tenantId: string;
}

/**
 * Build a cache-key `d` (data) descriptor from optional filter values, dropping
 * any that are undefined. `keys.*()` requires `Record<string, string | number>`
 * (no `undefined`); unset filters simply shouldn't contribute to the key.
 */
export function scopeData(
  input: Record<string, string | number | undefined | null>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}
