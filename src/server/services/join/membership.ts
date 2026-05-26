import { eq, and } from 'drizzle-orm';
import { member, user, organization } from '@minion-stack/db/schema';
import type { Db } from '$server/db/client';

export interface MembershipUser {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * Ensure a Turso `user` row exists and the user is a `member` of `orgId`.
 * Idempotent: re-running with the same user/org is a no-op.
 *
 * Note: `createdAt`/`updatedAt` are timestamp columns (mode: 'timestamp')
 * and therefore expect Date objects, not raw epoch numbers.
 */
export async function createMembership(
  db: Db,
  u: MembershipUser,
  orgId: string,
  role: string,
): Promise<void> {
  const now = new Date();

  const existingUser = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, u.id))
    .limit(1);

  if (existingUser.length === 0) {
    await db.insert(user).values({
      id: u.id,
      name: u.displayName ?? u.email.split('@')[0],
      email: u.email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
      personalAgentId: `personal-${u.id}`,
      role: 'user',
    });
  }

  const existingMember = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, u.id), eq(member.organizationId, orgId)))
    .limit(1);

  if (existingMember.length === 0) {
    await db.insert(member).values({
      id: `m-${u.id.slice(0, 12)}-${orgId.slice(0, 8)}`,
      organizationId: orgId,
      userId: u.id,
      role: role === 'admin' ? 'admin' : 'member',
      createdAt: now,
    });
  }

  void organization; // imported for schema clarity / future org validation
}
