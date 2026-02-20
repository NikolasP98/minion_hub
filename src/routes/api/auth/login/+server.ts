import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$server/db/client';
import { users } from '$server/db/schema';
import { verifyPassword } from '$server/auth/password';
import { createSession, SESSION_COOKIE } from '$server/auth/session';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const { email, password } = await request.json();

  if (!email || !password) {
    throw error(400, 'email and password are required');
  }

  const db = getDb();

  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));

  if (rows.length === 0) throw error(401, 'Invalid credentials');

  const user = rows[0];
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) throw error(401, 'Invalid credentials');

  const session = await createSession(db, user.id);

  cookies.set(SESSION_COOKIE, session.token, {
    path: '/',
    httpOnly: true,
    secure: event.url.protocol === 'https:',
    sameSite: 'lax',
    expires: session.expiresAt,
  });

  return json({ ok: true });
};
