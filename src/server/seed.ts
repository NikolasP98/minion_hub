import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization as orgPlugin } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { organization, member } from './db/schema';

// Seed-time auth instance using process.env directly (no SvelteKit virtual modules)
const auth = betterAuth({
  database: drizzleAdapter(getDb(), { provider: 'sqlite' }),
  secret: process.env.BETTER_AUTH_SECRET ?? 'seed-secret-not-used-in-prod',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  emailAndPassword: { enabled: true },
  plugins: [orgPlugin()],
});

async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@minion.hub';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'changeme';
  const orgName = process.env.SEED_TENANT_NAME ?? 'Default';
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  console.log(`Seeding organization "${orgName}" with admin user ${email}...`);

  const db = getDb();
  const now = new Date();

  // 1. Sign up the admin user (skip if already exists)
  let userId: string;
  const signUpResult = await auth.api.signUpEmail({
    body: { email, password, name: 'Admin' },
  }).catch(() => null);

  if (signUpResult?.user) {
    userId = signUpResult.user.id;
    console.log(`Created user: ${userId}`);
  } else {
    // User already exists — look them up
    const { user: userTable } = await import('./db/schema');
    const rows = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
    if (rows.length === 0) {
      console.error(`User ${email} not found and sign-up failed.`);
      process.exit(1);
    }
    userId = rows[0].id;
    console.log(`Found existing user: ${userId}`);
  }

  // 2. Create the organization if it doesn't exist
  const existing = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug)).limit(1);
  let orgId: string;
  if (existing.length > 0) {
    orgId = existing[0].id;
    console.log(`Organization already exists: ${orgId}`);
  } else {
    orgId = crypto.randomUUID();
    await db.insert(organization).values({ id: orgId, name: orgName, slug, createdAt: now });
    console.log(`Created organization: ${orgId}`);
  }

  // 3. Add admin as organization owner (skip if already a member)
  const existingMember = await db.select({ id: member.id }).from(member)
    .where(eq(member.userId, userId)).limit(1);
  if (existingMember.length === 0) {
    await db.insert(member).values({
      id: crypto.randomUUID(),
      userId,
      organizationId: orgId,
      role: 'owner',
      createdAt: now,
    });
    console.log(`Added ${email} as owner of org ${orgId}`);
  } else {
    console.log(`User already a member of an org, skipping.`);
  }

  console.log(`Done! Organization: ${orgId}, User: ${userId}`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
