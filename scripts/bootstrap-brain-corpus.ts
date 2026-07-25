#!/usr/bin/env bun
/**
 * Ensure Master/All Conversations brains, discover every chat channel/account
 * source, and drain the deterministic conversation backfill for one org or all orgs.
 *
 * This is safe to rerun: source/document/chunk identities and content hashes
 * are stable, so unchanged chunks are not sent to the embeddings provider.
 *
 *   bun scripts/bootstrap-brain-corpus.ts <orgId> [--batch=50] [--max-rounds=1]
 *   bun scripts/bootstrap-brain-corpus.ts <orgId> --channel=instagram --account=<id>
 *   bun scripts/bootstrap-brain-corpus.ts --all [--batch=50]
 */
import './_sveltekit-bun-shim.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const args = process.argv.slice(2);
const all = args.includes('--all');
const orgArg = args.find((arg) => !arg.startsWith('--'));
const batchArg = args.find((arg) => arg.startsWith('--batch='));
const maxRoundsArg = args.find((arg) => arg.startsWith('--max-rounds='));
const channelArg = args.find((arg) => arg.startsWith('--channel='));
const accountArg = args.find((arg) => arg.startsWith('--account='));
const channel = channelArg?.slice('--channel='.length).trim().toLowerCase() || null;
const accountId = accountArg?.slice('--account='.length).trim() || null;
const batch = Math.max(1, Math.min(500, Number(batchArg?.split('=')[1] ?? 50)));
const maxRounds = maxRoundsArg
  ? Math.max(1, Math.floor(Number(maxRoundsArg.split('=')[1]) || 1))
  : Number.POSITIVE_INFINITY;
if (!all && !orgArg) {
  throw new Error('Pass an orgId or --all');
}
if ((channel && !accountId) || (!channel && accountId)) {
  throw new Error('--channel and --account must be passed together');
}
if (all && channel) {
  throw new Error('Targeted --channel/--account backfills require one orgId, not --all');
}

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 5 });
const db = drizzle(client);

async function bootstrapOrg(orgId: string) {
  const { bootstrapBrainCorpus, backfillConversations, backfillConversationSource } =
    await import('../src/server/services/brain-corpus.service.ts');
  const ctx = { db, tenantId: orgId } as unknown as import('../src/server/auth/core-ctx').CoreCtx;
  let cursor: string | null = null;
  let rounds = 0;
  let processed = 0;
  let changedChunks = 0;
  let embeddedChunks = 0;

  const runPage = channel
    ? (pageCursor: string | null) =>
        backfillConversationSource(ctx, channel, accountId!, {
          cursor: pageCursor,
          limit: batch,
        })
    : (pageCursor: string | null) =>
        backfillConversations(ctx, { cursor: pageCursor, limit: batch });
  const initial = channel
    ? {
        sources: [{ id: `${channel}:${accountId}` }],
        backfill: await runPage(cursor),
      }
    : await bootstrapBrainCorpus(ctx, { cursor, limit: batch });
  rounds += 1;
  processed += initial.backfill.processed;
  changedChunks += initial.backfill.changedChunks;
  embeddedChunks += initial.backfill.embeddedChunks;
  cursor = initial.backfill.nextCursor;
  console.log(
    `[${orgId}] round=${rounds} sources=${initial.sources.length} processed=${initial.backfill.processed} changed_chunks=${initial.backfill.changedChunks} embedded=${initial.backfill.embeddedChunks}`,
  );

  while (cursor && rounds < maxRounds) {
    const page = await runPage(cursor);
    rounds += 1;
    processed += page.processed;
    changedChunks += page.changedChunks;
    embeddedChunks += page.embeddedChunks;
    cursor = page.nextCursor;
    console.log(
      `[${orgId}] round=${rounds} processed=${page.processed} changed_chunks=${page.changedChunks} embedded=${page.embeddedChunks} has_more=${page.hasMore}`,
    );
  }
  const state = cursor ? 'PAUSED' : 'DONE';
  console.log(
    `[${orgId}] ${state} rounds=${rounds} processed=${processed} changed_chunks=${changedChunks} embedded=${embeddedChunks}`,
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
