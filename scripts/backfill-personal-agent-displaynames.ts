/**
 * One-time backfill: update personal agent displayNames from "X's Agent" to "usr:<email>".
 *
 * Usage:
 *   TURSO_DB_URL=file:./data/minion_hub.db bun run scripts/backfill-personal-agent-displaynames.ts
 *   # or for production:
 *   TURSO_DB_URL=libsql://... TURSO_DB_AUTH_TOKEN=... bun run scripts/backfill-personal-agent-displaynames.ts
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, not, like } from 'drizzle-orm';
import { user } from '../src/server/db/schema/auth/index.js';
import { personalAgents } from '../src/server/db/schema/personal-agents.js';

const url = process.env.TURSO_DB_URL ?? 'file:./data/minion_hub.db';
const authToken = process.env.TURSO_DB_AUTH_TOKEN;

const client = createClient({ url, authToken });
const db = drizzle(client);

// Find all personal agents whose displayName is NOT already in "usr:" format
const rows = await db
  .select({
    paId: personalAgents.id,
    userId: personalAgents.userId,
    agentId: personalAgents.agentId,
    displayName: personalAgents.displayName,
  })
  .from(personalAgents)
  .where(not(like(personalAgents.displayName, 'usr:%')));

if (rows.length === 0) {
  console.log('All personal agents already have usr: display names. Nothing to do.');
  process.exit(0);
}

console.log(`Found ${rows.length} personal agent(s) to backfill:\n`);

let updated = 0;
for (const row of rows) {
  // Look up the user's email
  const [u] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, row.userId))
    .limit(1);

  if (!u) {
    console.log(`  SKIP ${row.agentId} — user ${row.userId} not found`);
    continue;
  }

  const newDisplayName = `usr:${u.email}`;
  console.log(`  ${row.agentId}: "${row.displayName}" → "${newDisplayName}"`);

  await db
    .update(personalAgents)
    .set({ displayName: newDisplayName, updatedAt: Date.now() })
    .where(eq(personalAgents.id, row.paId));

  updated++;
}

console.log(`\nDone. Updated ${updated}/${rows.length} personal agent(s).`);
process.exit(0);
