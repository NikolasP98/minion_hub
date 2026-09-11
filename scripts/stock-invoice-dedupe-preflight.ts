#!/usr/bin/env bun
/** Read-only migration preflight. No customer fields or ledger mutations.
 * Run: STOCK_PREFLIGHT_DB_URL=... bun scripts/stock-invoice-dedupe-preflight.ts --read-only
 * Do not use --apply: this utility has no write mode.
 */
import postgres from 'postgres';

// Legacy invoice issues may lack metadata.source. A non-empty invoiceId on an
// active issue is the identity; source labels must not bypass duplicate defense.
export const invoiceIssuePredicate = `type = 'issue' AND status IN ('draft', 'submitted')
  AND jsonb_typeof(metadata->'invoiceId') = 'string'
  AND btrim(metadata->>'invoiceId') <> ''`;
export const invoiceCollisionSql = `SELECT org_id, lower(btrim(metadata->>'invoiceId')) AS invoice_id,
  count(*)::integer AS entry_count, array_agg(id::text ORDER BY id) AS entry_ids
  FROM public.stk_entries WHERE ${invoiceIssuePredicate}
  GROUP BY org_id, lower(btrim(metadata->>'invoiceId')) HAVING count(*) > 1
  ORDER BY org_id, lower(btrim(metadata->>'invoiceId'))`;
export const invoiceInvalidIdentitySql = `SELECT id::text AS entry_id, org_id
  FROM public.stk_entries WHERE type='issue' AND status IN ('draft', 'submitted')
    AND metadata ? 'invoiceId'
    AND (jsonb_typeof(metadata->'invoiceId') IS DISTINCT FROM 'string'
      OR btrim(metadata->>'invoiceId') = '') ORDER BY org_id, id`;

export function validatePreflightArgs(args: string[]): void {
  if (args.length !== 1 || args[0] !== '--read-only') {
    throw new Error('Expected only --read-only; no write mode is supported');
  }
}

if (import.meta.main) {
  validatePreflightArgs(process.argv.slice(2));
  const url = process.env.STOCK_PREFLIGHT_DB_URL?.trim();
  if (!url || !/^postgres(?:ql)?:\/\//.test(url)) {
    throw new Error('Set STOCK_PREFLIGHT_DB_URL explicitly to a PostgreSQL connection');
  }
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    const report = await client.begin('read only', async (tx) => {
      await tx`set local statement_timeout = '15s'`;
      const collisions = await tx.unsafe(invoiceCollisionSql);
      const invalid = await tx.unsafe(invoiceInvalidIdentitySql);
      return {
        ready: collisions.length === 0 && invalid.length === 0,
        collisionGroups: collisions.length,
        invalidIdentities: invalid.length,
        collisions,
        invalid,
      };
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 2;
  } finally {
    await client.end();
  }
}
