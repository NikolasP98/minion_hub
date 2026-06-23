import { sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';

/**
 * Human-readable document IDs (ERPNext naming series). `nextSerialId` MUST run
 * inside a withOrgCore transaction (the caller's insert tx) so the counter bump
 * and the row insert commit together.
 */

/** Render a template's prefix, expanding date tokens; stops at the counter (#).
 *  'SO-.YYYY.-' → 'SO-2026-'   ·   'BKG-.YYYY.-.MM.-' → 'BKG-2026-06-' */
export function evaluatePrefix(template: string, now: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  let out = '';
  for (const part of template.split('.')) {
    if (part.startsWith('#')) break;
    if (part === 'YYYY') out += String(now.getFullYear());
    else if (part === 'YY') out += String(now.getFullYear()).slice(-2);
    else if (part === 'MM') out += pad2(now.getMonth() + 1);
    else if (part === 'DD') out += pad2(now.getDate());
    else out += part;
  }
  return out;
}

/**
 * Atomically allocate the next ID for `template` in this org and return the
 * formatted string (prefix + zero-padded counter). Concurrency-safe via a single
 * upsert-returning. Default 5 digits.
 */
export async function nextSerialId(
  tx: CoreTx,
  orgId: string,
  template: string,
  now: Date,
  digits = 5,
): Promise<string> {
  const prefix = evaluatePrefix(template, now);
  const rows = (await tx.execute(sql`
    insert into naming_series_counters (org_id, prefix, n)
    values (${orgId}, ${prefix}, 1)
    on conflict (org_id, prefix) do update set n = naming_series_counters.n + 1, updated_at = now()
    returning n
  `)) as unknown as Array<{ n: number | string }>;
  const counter = Number(rows[0]?.n ?? 1);
  return prefix + String(counter).padStart(digits, '0');
}
