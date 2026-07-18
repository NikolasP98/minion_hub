#!/usr/bin/env bun
/**
 * One-time (or catch-up) drain of the CRM conversation vectorizer (spec
 * 2026-07-17-crm-conversation-intelligence-spec.md §2 WP-A / §6). Loops
 * `vectorizeTick(ctx, { full: true, batch })` until `remaining === 0` — the
 * SAME idempotent tick the cron will call, just called repeatedly here
 * instead of on a schedule. `full: true` so the very first run (no
 * crm_conversation_index rows yet) treats every eligible conversation as a
 * candidate.
 *
 * 🚫 PROD GATE: this hits whatever SUPABASE_DB_URL resolves to. Do NOT point
 * it at prod without explicit user go-ahead (spec §4) — local/dev org only
 * until then.
 *
 *   bun scripts/backfill-conversation-vectors.ts [orgId] [--batch=200]
 */
import './_sveltekit-bun-shim.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const args = process.argv.slice(2);
const orgId = args.find((x) => !x.startsWith('--')) ?? FACES_ORG;
const batchArg = args.find((x) => x.startsWith('--batch='));
const batch = batchArg ? Number(batchArg.split('=')[1]) : 200;

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 5 });

async function main() {
  const { vectorizeTick } = await import('../src/server/services/crm-conversation-vectors.service.ts');
  const db = drizzle(client);
  const ctx = { db, tenantId: orgId } as unknown as import('../src/server/auth/core-ctx').CoreCtx;

  // full:true re-selects the WHOLE corpus every call (weekly-reconcile
  // semantics) — offset pages through it so repeated rounds don't just
  // reprocess the same first `batch` conversations forever.
  let offset = 0;
  let totalProcessed = 0;
  let totalDirty = 0;
  let rounds = 0;
  for (;;) {
    rounds += 1;
    const r = await vectorizeTick(ctx, { full: true, batch, offset });
    if (r.skipped === 'locked') {
      console.log(`round ${rounds}: SKIPPED (advisory lock held elsewhere) — retrying`);
      continue;
    }
    totalProcessed += r.processed;
    totalDirty += r.dirty;
    console.log(
      `round ${rounds}: offset=${offset} processed=${r.processed} dirty=${r.dirty} remaining=${r.remaining}`,
    );
    if (r.processed === 0 || r.remaining === 0) break;
    offset += batch;
  }
  console.log(`DONE — ${rounds} round(s), ${totalProcessed} conversations processed, ${totalDirty} (re)embedded.`);
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
