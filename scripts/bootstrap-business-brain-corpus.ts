#!/usr/bin/env bun
/**
 * Rerunnable Master Brain backfill/reconciliation for Hub business domains.
 *
 * Stable source IDs, table-prefixed document IDs, content hashes, and chunk
 * hashes make unchanged pages embedding-free. The final page of each domain
 * also tombstones deleted source records and removes their retrievable chunks.
 *
 *   bun scripts/bootstrap-business-brain-corpus.ts <orgId> [--batch=100]
 *   bun scripts/bootstrap-business-brain-corpus.ts --all [--batch=100]
 *   bun scripts/bootstrap-business-brain-corpus.ts <orgId> --domains=stock,crm
 *   bun scripts/bootstrap-business-brain-corpus.ts <orgId> --domains=crm --start-table=1
 *   bun scripts/bootstrap-business-brain-corpus.ts <orgId> --domains=crm --start-table=0 --single-table
 */
import './_sveltekit-bun-shim.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { BusinessKnowledgeDomainKey } from '../src/server/services/brain-business-corpus.service.ts';
import type { CoreCtx } from '../src/server/auth/core-ctx.ts';

// The alias shim must be registered before Bun evaluates service imports.
const {
  BUSINESS_KNOWLEDGE_DOMAINS,
  backfillBusinessKnowledgeDomain,
  decodeBusinessKnowledgeCursor,
  encodeBusinessKnowledgeCursor,
  getBusinessKnowledgeDomain,
  reconcileAllBusinessKnowledge,
  validateBusinessKnowledgeSchema,
} = await import('../src/server/services/brain-business-corpus.service.ts');

const args = process.argv.slice(2);
const all = args.includes('--all');
const orgArg = args.find((arg) => !arg.startsWith('--'));
const batchArg = args.find((arg) => arg.startsWith('--batch='));
const domainsArg = args.find((arg) => arg.startsWith('--domains='));
const startTableArg = args.find((arg) => arg.startsWith('--start-table='));
const singleTable = args.includes('--single-table');
const batch = Math.max(1, Math.min(500, Number(batchArg?.split('=')[1] ?? 100)));
const startTable = startTableArg ? Number(startTableArg.split('=')[1]) : null;
const allowed = new Set(BUSINESS_KNOWLEDGE_DOMAINS.map((domain) => domain.key));
const domains = domainsArg
  ? domainsArg
      .slice('--domains='.length)
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is BusinessKnowledgeDomainKey =>
        allowed.has(value as BusinessKnowledgeDomainKey),
      )
  : undefined;

if (!all && !orgArg) throw new Error('Pass an orgId or --all');
if (domainsArg && domains?.length === 0)
  throw new Error('--domains did not contain a known domain');
if (startTable !== null && (!Number.isInteger(startTable) || startTable < 0))
  throw new Error('--start-table must be a non-negative integer');
if (startTable !== null && domains?.length !== 1)
  throw new Error('--start-table requires exactly one --domains entry');
if (startTable !== null && startTable >= getBusinessKnowledgeDomain(domains![0]).tables.length)
  throw new Error('--start-table is outside the selected domain table range');
if (singleTable && startTable === null) throw new Error('--single-table requires --start-table');

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 5 });
const db = drizzle(client);

async function reconcileOrg(orgId: string) {
  const totals = new Map<
    string,
    { processed: number; changed: number; embedded: number; deleted: number }
  >();
  const ctx = { db, tenantId: orgId } as unknown as CoreCtx;
  const recordPage = (result: Awaited<ReturnType<typeof backfillBusinessKnowledgeDomain>>) => {
    const total = totals.get(result.domain) ?? {
      processed: 0,
      changed: 0,
      embedded: 0,
      deleted: 0,
    };
    total.processed += result.processed;
    total.changed += result.changedDocuments;
    total.embedded += result.embeddedChunks;
    total.deleted += result.deletedDocuments;
    totals.set(result.domain, total);
    console.log(
      `[${orgId}] domain=${result.domain} processed=${result.processed} changed=${result.changedDocuments} embedded=${result.embeddedChunks} deleted=${result.deletedDocuments} has_more=${result.hasMore}`,
    );
  };

  if (startTable !== null) {
    const domain = domains![0];
    await validateBusinessKnowledgeSchema(ctx, [domain]);
    let cursor: string | null = encodeBusinessKnowledgeCursor({
      domain,
      tableIndex: startTable,
      lastId: null,
    });
    while (cursor) {
      const result = await backfillBusinessKnowledgeDomain(ctx, domain, {
        cursor,
        limit: batch,
      });
      recordPage(result);
      const next = decodeBusinessKnowledgeCursor(result.nextCursor);
      cursor = singleTable && next?.tableIndex !== startTable ? null : result.nextCursor;
    }
  } else {
    await reconcileAllBusinessKnowledge(ctx, {
      limit: batch,
      domains,
      onPage: recordPage,
    });
  }
  for (const [domain, total] of totals) {
    console.log(
      `[${orgId}] DONE domain=${domain} processed=${total.processed} changed=${total.changed} embedded=${total.embedded} deleted=${total.deleted}`,
    );
  }
}

async function main() {
  const orgIds = all
    ? (await client`select id::text as id from organizations order by id`).map((row) =>
        String(row.id),
      )
    : [orgArg!];
  for (const orgId of orgIds) await reconcileOrg(orgId);
}

main()
  .then(() => client.end())
  .catch(async (cause) => {
    console.error(cause);
    await client.end();
    process.exit(1);
  });
