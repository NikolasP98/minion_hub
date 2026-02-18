import { eq, and, gt } from 'drizzle-orm';
import { authSessions } from '$server/db/schema';
import { users, userTenants } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { Db } from '$server/db/client';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = 'mh_session';

async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSession(db: Db, userId: string) {
  const token = generateToken();
  const tokenHash = await sha256(token);
  const now = nowMs();

  await db.insert(authSessions).values({
    id: newId(),
    userId,
    tokenHash,
    expiresAt: now + SESSION_DURATION_MS,
    createdAt: now,
  });

  return { token, expiresAt: new Date(now + SESSION_DURATION_MS) };
}

export async function validateSession(db: Db, token: string) {
  const tokenHash = await sha256(token);
  const now = nowMs();

  const rows = await db
    .select({
      sessionId: authSessions.id,
      userId: authSessions.userId,
      expiresAt: authSessions.expiresAt,
      email: users.email,
      displayName: users.displayName,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, now)));

  if (rows.length === 0) return null;

  const row = rows[0];

  // Get the user's first tenant membership
  const memberships = await db
    .select({
      tenantId: userTenants.tenantId,
      role: userTenants.role,
    })
    .from(userTenants)
    .where(eq(userTenants.userId, row.userId));

  const membership = memberships[0];

  return {
    user: {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
    },
    tenantId: membership?.tenantId ?? null,
    role: membership?.role ?? null,
  };
}

export async function deleteSession(db: Db, token: string) {
  const tokenHash = await sha256(token);
  await db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
}
