import type { Handle } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { validateSession, SESSION_COOKIE } from '$server/auth/session';

export const handle: Handle = async ({ event, resolve }) => {
  // Skip auth for auth routes and public assets
  if (event.url.pathname.startsWith('/api/auth/')) {
    return resolve(event);
  }

  const token = event.cookies.get(SESSION_COOKIE);

  if (token) {
    const db = getDb();
    const session = await validateSession(db, token);

    if (session) {
      event.locals.user = session.user;
      event.locals.role = session.role as App.Locals['role'];

      if (session.tenantId) {
        event.locals.tenantCtx = {
          db,
          tenantId: session.tenantId,
        };
      }
    }
  }

  return resolve(event);
};
