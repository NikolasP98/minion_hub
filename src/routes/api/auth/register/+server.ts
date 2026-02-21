import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$server/db/client';
import { users, tenants, userTenants } from '$server/db/schema';
import { hashPassword } from '$server/auth/password';
import { createSession, SESSION_COOKIE } from '$server/auth/session';
import { newId, nowMs } from '$server/db/utils';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const { email, password, name, tenantName } = await request.json();

  if (!email || !password || !tenantName) {
    throw error(400, 'email, password, and tenantName are required');
  }

  const db = getDb();
  const now = nowMs();

  // Check if email already taken
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length > 0) throw error(409, 'Email already registered');

  const userId = newId();
  const tenantId = newId();
  const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // Create tenant
  await db.insert(tenants).values({
    id: tenantId,
    name: tenantName,
    slug,
    createdAt: now,
    updatedAt: now,
  });

  // Create user
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hashPassword(password),
    displayName: name ?? null,
    createdAt: now,
    updatedAt: now,
  });

  // Link user to tenant as owner
  await db.insert(userTenants).values({
    userId,
    tenantId,
    role: 'owner',
    joinedAt: now,
  });

  // Create session
  const session = await createSession(db, userId);

  cookies.set(SESSION_COOKIE, session.token, {
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    expires: session.expiresAt,
  });

  return json({ ok: true, userId, tenantId });
};
