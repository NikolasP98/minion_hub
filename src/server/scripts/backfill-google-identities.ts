// One-time backfill: run after migration 0014. Reads Better Auth google
// accounts and writes encrypted ADC rows into user_identities. Idempotent
// (upsert on provider+external_id).
// Run: GOOGLE_CLIENT_ID=.. GOOGLE_CLIENT_SECRET=.. TURSO_DB_URL=.. \
//      bun run src/server/scripts/backfill-google-identities.ts
//
// Builds its own libsql client from process.env (avoids the SvelteKit
// $env virtual module so it runs under plain `bun run`).
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { account, user } from '@minion-stack/db/schema';
import { attachGoogleIdentity } from '../services/identity.service';
import type { Db } from '../db/client';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
}

async function main() {
  const url = process.env.TURSO_DB_URL ?? 'file:./data/minion_hub.db';
  const authToken = process.env.TURSO_DB_AUTH_TOKEN;
  const db = drizzle(createClient({ url, authToken })) as unknown as Db;

  const rows = await db.select().from(account).where(eq(account.providerId, 'google'));
  let migrated = 0;
  for (const a of rows) {
    if (!a.refreshToken) continue; // no usable long-lived grant
    const u = (await db.select().from(user).where(eq(user.id, a.userId)))[0];
    const email = u?.email ?? a.accountId;
    await attachGoogleIdentity({ db, tenantId: 'default' }, a.userId, {
      email,
      adc: {
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        refresh_token: a.refreshToken,
        type: 'authorized_user',
      },
      scope: a.scope ?? undefined,
      expiresAt: a.refreshTokenExpiresAt ? Number(a.refreshTokenExpiresAt) : undefined,
    });
    migrated++;
  }
  console.log(`[backfill] google identities migrated: ${migrated}/${rows.length}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[backfill] failed:', err);
    process.exit(1);
  },
);
