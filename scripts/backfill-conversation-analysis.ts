#!/usr/bin/env bun
/**
 * One-time (or catch-up) drain of the CRM conversation analyzer (spec
 * 2026-07-17-crm-conversation-intelligence-spec.md §2 WP-A / §6). Loops
 * `analyzeConversationsTick(ctx, { full: true, limit, offset })` until
 * `remaining === 0` — same idempotent tick the cron will call.
 *
 * 💸 THIS ONE COSTS MONEY (one LLM call per un-analyzed conversation, capped
 * at 120/round). Unlike the vectors backfill (~$0.03 for the whole corpus),
 * analyzing the full ~10k-conversation corpus is the "$10+" run the spec
 * explicitly says NOT to run without a go-ahead. Use `--max-rounds=N` to cap
 * how far this drains (e.g. `--max-rounds=1 --limit=5` to prove the pipeline
 * end-to-end on a handful of conversations without paying for the rest).
 *
 * 🚫 PROD GATE: hits whatever SUPABASE_DB_URL resolves to. Do NOT point it at
 * prod, and do NOT run a full drain, without explicit user go-ahead (spec §4).
 *
 *   bun scripts/backfill-conversation-analysis.ts [orgId] [--limit=120] [--max-rounds=N]
 */
import './_sveltekit-bun-shim.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const args = process.argv.slice(2);
const orgId = args.find((x) => !x.startsWith('--')) ?? FACES_ORG;
const limitArg = args.find((x) => x.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 120;
const maxRoundsArg = args.find((x) => x.startsWith('--max-rounds='));
const maxRounds = maxRoundsArg ? Number(maxRoundsArg.split('=')[1]) : Infinity;

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 5 });

async function main() {
  const { analyzeConversationsTick } = await import(
    '../src/server/services/crm-conversation-analysis.service.ts'
  );
  const db = drizzle(client);
  const ctx = { db, tenantId: orgId } as unknown as import('../src/server/auth/core-ctx').CoreCtx;

  let offset = 0;
  let totalProcessed = 0;
  let totalAnalyzed = 0;
  let totalFailed = 0;
  let rounds = 0;
  for (;;) {
    if (rounds >= maxRounds) {
      console.log(`STOPPED — hit --max-rounds=${maxRounds} (by design, not drained).`);
      break;
    }
    rounds += 1;
    const r = await analyzeConversationsTick(ctx, { full: true, limit, offset });
    if (r.skipped === 'locked') {
      console.log(`round ${rounds}: SKIPPED (advisory lock held elsewhere) — retrying`);
      rounds -= 1;
      continue;
    }
    totalProcessed += r.processed;
    totalAnalyzed += r.analyzed;
    totalFailed += r.failed;
    console.log(
      `round ${rounds}: offset=${offset} processed=${r.processed} dirty=${r.dirty} analyzed=${r.analyzed} failed=${r.failed} remaining=${r.remaining}`,
    );
    if (r.processed === 0 || r.remaining === 0) break;
    offset += limit;
  }
  console.log(
    `DONE — ${rounds} round(s), ${totalProcessed} conversations processed, ${totalAnalyzed} analyzed, ${totalFailed} failed.`,
  );
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
