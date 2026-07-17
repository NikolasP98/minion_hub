#!/usr/bin/env bun
/**
 * APPLY the Tier-2 IG-DM ad-attribution backfill (writes meta_lead_attribution,
 * provenance='heuristic-icebreaker'). Idempotent (upsert on org+channel+sender);
 * webhook rows stay authoritative. Reverse with: delete where
 * provenance='heuristic-icebreaker'. Same bun-shim rationale as the dry-run.
 *
 *   bun scripts/attribution-backfill-apply.ts [orgId]
 */
import './_sveltekit-bun-shim.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const orgId = process.argv.slice(2).find((x) => !x.startsWith('--')) ?? FACES_ORG;
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 5 });

async function main() {
  const { runBackfill } = await import('../src/server/services/meta/attribution-backfill.service.ts');
  const db = drizzle(client);
  const ctx = { db, tenantId: orgId } as unknown as import('../src/server/auth/core-ctx').CoreCtx;
  const r = await runBackfill(ctx, { dryRun: false });
  console.log(`APPLIED — ${r.total} leads processed. buckets:`, JSON.stringify(r.buckets));
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
