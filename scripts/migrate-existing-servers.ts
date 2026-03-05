import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { user, userServers, servers } from '../src/server/db/schema/index.js';

const url = process.env.TURSO_DB_URL ?? 'file:./data/minion_hub.db';
const authToken = process.env.TURSO_DB_AUTH_TOKEN;

const client = createClient({ url, authToken });
const db = drizzle(client, { schema: { user, userServers, servers } });

const adminRows = await db.select({ id: user.id })
  .from(user)
  .where(eq(user.email, 'admin@minion.hub'))
  .limit(1);

if (!adminRows[0]) {
  console.log('No admin@minion.hub user found — skipping migration');
  // List all users so we can see what is there
  const allUsers = await db.select({ id: user.id, email: user.email }).from(user);
  console.log('Existing users:', allUsers);
  process.exit(0);
}

const adminId = adminRows[0].id;
console.log(`Found admin user: ${adminId}`);

const allServers = await db.select({ id: servers.id }).from(servers);
console.log(`Found ${allServers.length} servers`);
const now = Date.now();

let linked = 0;
for (const s of allServers) {
  await db.insert(userServers)
    .values({ userId: adminId, serverId: s.id, createdAt: now })
    .onConflictDoNothing();
  linked++;
}

console.log(`Linked ${linked} servers to admin@minion.hub`);
client.close();
