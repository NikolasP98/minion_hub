#!/usr/bin/env bun
/**
 * Exercise the production hybrid retrieval path without printing message or
 * contact content.
 *
 *   bun --env-file=.env.local scripts/verify-conversation-brain.ts <orgId> instagram
 */
import './_sveltekit-bun-shim.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const [orgId, rawConnector] = process.argv.slice(2);
const connector = rawConnector?.trim().toLowerCase();
if (!orgId || !connector) {
  throw new Error('Pass an orgId and connector');
}

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 5 });
const db = drizzle(client);

async function main() {
  const [brain] = await client<
    Array<{ id: string; name: string }>
  >`select id::text, name from brains
    where org_id = ${orgId}
      and name in ('All Conversations', 'WhatsApp Conversations')
    order by case when name = 'All Conversations' then 0 else 1 end
    limit 1`;
  if (!brain) throw new Error(`No conversation brain found for org ${orgId}`);

  const { searchBrainHybrid } =
    await import('../src/server/services/brain-hybrid-retrieval.service.ts');
  const ctx = {
    db,
    tenantId: orgId,
  } as unknown as import('../src/server/auth/core-ctx').CoreCtx;
  const result = await searchBrainHybrid(
    ctx,
    brain.id,
    `${connector} conversation`,
    { connectors: [connector], limit: 3 },
    {
      roles: ['owner'],
      searchableModules: ['crm'],
      fieldLevels: { crm: 5 },
    },
  );
  if (result.hits.length === 0) {
    throw new Error(
      `Conversation brain returned no ${connector} hits; warnings=${result.diagnostics.warnings.join(',')}`,
    );
  }
  if (result.hits.some((hit) => hit.connector !== connector)) {
    throw new Error(`Conversation brain returned a result outside connector ${connector}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      brain: brain.name,
      connector,
      mode: result.mode,
      hits: result.hits.length,
      vectorCandidates: result.diagnostics.vectorCandidates,
      lexicalCandidates: result.diagnostics.lexicalCandidates,
      warnings: result.diagnostics.warnings,
    }),
  );
}

main()
  .then(() => client.end())
  .catch(async (cause) => {
    console.error(cause);
    await client.end();
    process.exit(1);
  });
