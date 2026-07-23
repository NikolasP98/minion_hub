#!/usr/bin/env bun
/**
 * Ensure Master/WhatsApp Focused brains, discover WhatsApp account sources,
 * and drain the deterministic conversation backfill for one org or all orgs.
 *
 * This is safe to rerun: source/document/chunk identities and content hashes
 * are stable, so unchanged chunks are not sent to the embeddings provider.
 *
 *   bun scripts/bootstrap-brain-corpus.ts <orgId> [--batch=50]
 *   bun scripts/bootstrap-brain-corpus.ts --all [--batch=50]
 */
import './_sveltekit-bun-shim.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const args = process.argv.slice(2);
const all = args.includes('--all');
const orgArg = args.find((arg) => !arg.startsWith('--'));
const batchArg = args.find((arg) => arg.startsWith('--batch='));
const batch = Math.max(1, Math.min(500, Number(batchArg?.split('=')[1] ?? 50)));
if (!all && !orgArg) {
  throw new Error('Pass an orgId or --all');
}

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 5 });
const db = drizzle(client);

async function bootstrapOrg(orgId: string) {
  const { bootstrapBrainCorpus, backfillWhatsAppConversations } =
    await import('../src/server/services/brain-corpus.service.ts');
  const ctx = { db, tenantId: orgId } as unknown as import('../src/server/auth/core-ctx').CoreCtx;
  let cursor: string | null = null;
  let rounds = 0;
  let processed = 0;
  let changedChunks = 0;
  let embeddedChunks = 0;

  const initial = await bootstrapBrainCorpus(ctx, { cursor, limit: batch });
  rounds += 1;
  processed += initial.backfill.processed;
  changedChunks += initial.backfill.changedChunks;
  embeddedChunks += initial.backfill.embeddedChunks;
  cursor = initial.backfill.nextCursor;
  console.log(
    `[${orgId}] round=${rounds} sources=${initial.sources.length} processed=${initial.backfill.processed} changed_chunks=${initial.backfill.changedChunks} embedded=${initial.backfill.embeddedChunks}`,
  );

  while (cursor) {
    const page = await backfillWhatsAppConversations(ctx, { cursor, limit: batch });
    rounds += 1;
    processed += page.processed;
    changedChunks += page.changedChunks;
    embeddedChunks += page.embeddedChunks;
    cursor = page.nextCursor;
    console.log(
      `[${orgId}] round=${rounds} processed=${page.processed} changed_chunks=${page.changedChunks} embedded=${page.embeddedChunks} has_more=${page.hasMore}`,
    );
  }
  console.log(
    `[${orgId}] DONE rounds=${rounds} processed=${processed} changed_chunks=${changedChunks} embedded=${embeddedChunks}`,
  );
}

async function main() {
  const orgIds = all
    ? (await client`select id::text as id from organizations order by id`).map((row) =>
        String(row.id),
      )
    : [orgArg!];
  for (const orgId of orgIds) await bootstrapOrg(orgId);
}

main()
  .then(() => client.end())
  .catch(async (cause) => {
    console.error(cause);
    await client.end();
    process.exit(1);
  });
