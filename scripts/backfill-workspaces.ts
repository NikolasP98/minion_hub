/**
 * Backfill hub `workspace_membership` rows from paperclip's company list.
 *
 * For each existing hub user, mint an identity-only JWT (no companyId, since
 * /api/companies is the top-level list, NOT path-scoped), call paperclip's
 * companies.list(), and upsert one membership row per visible company.
 *
 * Run (after configuring secrets via Infisical):
 *   HUB_PAPERCLIP_SHARED_SECRET=$(infisical run --projectId=<minion-hub> -- printenv HUB_PAPERCLIP_SHARED_SECRET) \
 *     PAPERCLIP_INTERNAL_URL=http://paperclip:3200 \
 *     TURSO_DB_URL=file:./data/minion_hub.db \
 *     bun run scripts/backfill-workspaces.ts
 *
 * For production:
 *   TURSO_DB_URL=libsql://... TURSO_DB_AUTH_TOKEN=... \
 *   HUB_PAPERCLIP_SHARED_SECRET=... PAPERCLIP_INTERNAL_URL=http://paperclip:3200 \
 *     bun run scripts/backfill-workspaces.ts
 *
 * Idempotent: uses INSERT ... ON CONFLICT DO NOTHING on the composite PK
 * (user_id, paperclip_company_id).
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { createPaperclipClient, mintIdentity } from '@minion-stack/paperclip-client';
import { user as userTable } from '../src/server/db/schema/auth/index.js';
import { workspaceMembership } from '../src/server/db/schema/workspace-membership.js';

async function main() {
  const secret = process.env.HUB_PAPERCLIP_SHARED_SECRET;
  if (!secret) {
    console.error('FATAL: HUB_PAPERCLIP_SHARED_SECRET not set');
    process.exit(1);
  }

  const baseUrl = process.env.PAPERCLIP_INTERNAL_URL ?? 'http://paperclip:3200';
  const dbUrl = process.env.TURSO_DB_URL ?? 'file:./data/minion_hub.db';
  const authToken = process.env.TURSO_DB_AUTH_TOKEN;

  const client = createClient({ url: dbUrl, authToken });
  const db = drizzle(client);

  const users = await db.select().from(userTable);
  console.log(`Found ${users.length} hub user(s) to process`);

  let totalRows = 0;
  for (const u of users) {
    const token = await mintIdentity({
      secret,
      claims: {
        userId: u.id,
        email: u.email ?? null,
        name: u.name ?? null,
        companyId: null,
      },
      ttlSeconds: 300,
    });

    const paperclip = createPaperclipClient({
      baseUrl,
      fetch: globalThis.fetch,
      headers: { 'x-hub-identity': token },
    });

    let companies: { id: string; name: string }[] = [];
    try {
      companies = await paperclip.companies.list();
    } catch (e) {
      console.warn(`skip ${u.id} (${u.email}): companies.list failed:`, (e as Error).message);
      continue;
    }

    for (const c of companies) {
      await db
        .insert(workspaceMembership)
        .values({
          userId: u.id,
          paperclipCompanyId: c.id,
          role: 'admin',
          createdAt: new Date(),
        })
        .onConflictDoNothing();
      totalRows += 1;
    }

    console.log(`backfilled ${u.id} (${u.email}): ${companies.length} companies`);
  }

  console.log(`\ndone: ${totalRows} row(s) upserted across ${users.length} user(s)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
