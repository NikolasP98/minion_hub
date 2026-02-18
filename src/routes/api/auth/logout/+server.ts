import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { deleteSession, SESSION_COOKIE } from '$server/auth/session';

export const POST: RequestHandler = async ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE);

  if (token) {
    const db = getDb();
    await deleteSession(db, token);
    cookies.delete(SESSION_COOKIE, { path: '/' });
  }

  return json({ ok: true });
};
