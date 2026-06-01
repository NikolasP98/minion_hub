import { eq, and, desc } from 'drizzle-orm';
import { joinRequests, member } from '@minion-stack/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export type JoinRequestStatus = 'pending' | 'approved' | 'denied';

export interface JoinRequestRow {
  id: string;
  userId: string;
  orgId: string;
  email: string;
  message: string | null;
  status: JoinRequestStatus;
  reviewedBy: string | null;
  reviewedAt: number | null;
  createdAt: number;
}

export async function submitJoinRequest(
  db: TenantContext['db'],
  params: { userId: string; orgId: string; email: string; message?: string },
): Promise<JoinRequestRow> {
  const now = nowMs();
  const id = newId();

  // Check for duplicate pending request from same user to same org
  const [existing] = await db
    .select()
    .from(joinRequests)
    .where(
      and(
        eq(joinRequests.userId, params.userId),
        eq(joinRequests.orgId, params.orgId),
        eq(joinRequests.status, 'pending'),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const row = {
    id,
    userId: params.userId,
    orgId: params.orgId,
    email: params.email,
    message: params.message ?? null,
    status: 'pending' as const,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
  };

  await db.insert(joinRequests).values(row);
  return row;
}

export async function listPendingRequests(
  db: TenantContext['db'],
  orgId: string,
): Promise<JoinRequestRow[]> {
  return db
    .select()
    .from(joinRequests)
    .where(and(eq(joinRequests.orgId, orgId), eq(joinRequests.status, 'pending')))
    .orderBy(desc(joinRequests.createdAt));
}

export async function countPendingRequests(
  db: TenantContext['db'],
  orgId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(joinRequests)
    .where(and(eq(joinRequests.orgId, orgId), eq(joinRequests.status, 'pending')));
  return rows.length;
}

export async function reviewJoinRequest(
  db: TenantContext['db'],
  params: { requestId: string; orgId: string; reviewerId: string; status: 'approved' | 'denied' },
): Promise<void> {
  const now = nowMs();

  await db
    .update(joinRequests)
    .set({
      status: params.status,
      reviewedBy: params.reviewerId,
      reviewedAt: now,
    })
    .where(
      and(
        eq(joinRequests.id, params.requestId),
        eq(joinRequests.orgId, params.orgId),
      ),
    );

  // If approved, add user to the organization as a member
  if (params.status === 'approved') {
    const [request] = await db
      .select()
      .from(joinRequests)
      .where(eq(joinRequests.id, params.requestId))
      .limit(1);

    if (request) {
      await db
        .insert(member)
        .values({
          id: newId(),
          organizationId: params.orgId,
          userId: request.userId,
          role: 'member',
          createdAt: new Date(now),
        })
        .onConflictDoNothing();
    }
  }
}
