import { getDb } from './db/client';
import { tenants, users, userTenants } from './db/schema';
import { hashPassword } from './auth/password';
import { newId, nowMs } from './db/utils';

async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@minion.hub';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'changeme';
  const tenantName = process.env.SEED_TENANT_NAME ?? 'Default';

  const db = getDb();
  const now = nowMs();
  const tenantId = newId();
  const userId = newId();
  const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  console.log(`Seeding tenant "${tenantName}" with admin user ${email}...`);

  await db.insert(tenants).values({
    id: tenantId,
    name: tenantName,
    slug,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hashPassword(password),
    displayName: 'Admin',
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(userTenants).values({
    userId,
    tenantId,
    role: 'owner',
    joinedAt: now,
  });

  console.log(`Done! Tenant: ${tenantId}, User: ${userId}`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
