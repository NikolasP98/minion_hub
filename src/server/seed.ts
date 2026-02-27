import { auth } from '../lib/auth';
import { getDb } from './db/client';
import { organization, member } from './db/schema';

async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@minion.hub';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'changeme';
  const orgName = process.env.SEED_TENANT_NAME ?? 'Default';

  console.log(`Seeding organization "${orgName}" with admin user ${email}...`);

  // 1. Sign up the admin user via Better Auth
  const signUpResult = await auth.api.signUpEmail({
    body: {
      email,
      password,
      name: 'Admin',
    },
  });

  if (signUpResult.user == null) {
    console.error('Sign-up failed:', signUpResult);
    process.exit(1);
  }

  const userId = signUpResult.user.id;
  const db = getDb();
  const now = new Date();
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // 2. Create the organization directly in DB
  const orgId = crypto.randomUUID();
  await db.insert(organization).values({
    id: orgId,
    name: orgName,
    slug,
    createdAt: now,
  });

  // 3. Add admin as organization owner
  await db.insert(member).values({
    id: crypto.randomUUID(),
    userId,
    organizationId: orgId,
    role: 'owner',
    createdAt: now,
  });

  console.log(`Done! Organization: ${orgId}, User: ${userId}`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
