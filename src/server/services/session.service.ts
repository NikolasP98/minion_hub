import { eq, and, desc } from 'drizzle-orm';
import { sessions } from '@minion-stack/db/pg';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { newId } from '$server/db/utils';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { resolveGatewayId, resolveServerId } from '$server/services/gateway.pg.service';

export interface SessionInput {
  id?: string;
  serverId: string;
  agentId: string;
  sessionKey: string;
  status?: 'running' | 'thinking' | 'idle' | 'aborted' | 'completed';
  metadata?: string;
  startedAt?: number;
  endedAt?: number;
}

/**
 * pg rows key on gateway_id and store timestamps as `timestamptz` (Date). The
 * public shape of this service stays exactly as it was on Turso — `serverId`
 * (echoed) + epoch-number timestamps — so every caller (session monitors,
 * dropdowns, viewers that do `Date.now() - updatedAt`) is unaffected.
 */
type SessionRow = typeof sessions.$inferSelect;
const toEpoch = (d: Date | null): number | null => (d ? d.getTime() : null);

/** Only the columns `reshape` reads — avoids hauling the whole wide row. */
const sessionCols = {
  id: sessions.id,
  tenantId: sessions.tenantId,
  agentId: sessions.agentId,
  sessionKey: sessions.sessionKey,
  status: sessions.status,
  metadata: sessions.metadata,
  startedAt: sessions.startedAt,
  endedAt: sessions.endedAt,
  createdAt: sessions.createdAt,
  updatedAt: sessions.updatedAt,
} as const;

type ReshapeRow = Pick<
  SessionRow,
  | 'id'
  | 'tenantId'
  | 'agentId'
  | 'sessionKey'
  | 'status'
  | 'metadata'
  | 'startedAt'
  | 'endedAt'
  | 'createdAt'
  | 'updatedAt'
>;

function reshape(row: ReshapeRow, serverId: string) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    serverId,
    agentId: row.agentId,
    sessionKey: row.sessionKey,
    status: row.status,
    metadata: row.metadata,
    startedAt: toEpoch(row.startedAt),
    endedAt: toEpoch(row.endedAt),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function upsertSession(ctx: CoreCtx, input: SessionInput) {
  const gatewayId = await resolveGatewayId(input.serverId);
  if (!gatewayId) throw new Error(`No gateway found for server ${input.serverId}`);
  const id = input.id ?? newId();
  const now = new Date();

  await withOrgCore(ctx, (tx) =>
    tx
      .insert(sessions)
      .values({
        id,
        tenantId: ctx.tenantId,
        gatewayId,
        agentId: input.agentId,
        sessionKey: input.sessionKey,
        status: input.status ?? 'idle',
        metadata: input.metadata ?? null,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        endedAt: input.endedAt ? new Date(input.endedAt) : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [sessions.tenantId, sessions.gatewayId, sessions.sessionKey],
        set: {
          status: input.status ?? 'idle',
          metadata: input.metadata ?? null,
          endedAt: input.endedAt ? new Date(input.endedAt) : null,
          updatedAt: now,
        },
      }),
  );

  await invalidateTags([
    ...tags.tenantDomain(ctx.tenantId, 'sessions'),
    ...tags.entity('session', id),
  ]);

  return id;
}

export async function listSessions(ctx: CoreCtx, serverId: string) {
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return [];
  return cached(
    keys.hub('sessions', { t: ctx.tenantId, d: { serverId } }),
    {
      ttl: '2m',
      swr: '30s',
      tags: tags.tenantDomain(ctx.tenantId, 'sessions'),
    },
    async () =>
      withOrgCore(ctx, async (tx) => {
        const rows = await tx
          .select(sessionCols)
          .from(sessions)
          .where(and(eq(sessions.gatewayId, gatewayId), eq(sessions.tenantId, ctx.tenantId)))
          .orderBy(desc(sessions.updatedAt))
          .limit(1000);
        return rows.map((r) => reshape(r, serverId));
      }),
  );
}

export async function listSessionsByServer(ctx: CoreCtx, serverId: string, agentId?: string) {
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return [];
  return cached(
    keys.hub('sessions', { t: ctx.tenantId, d: { agentId: agentId ?? '', serverId } }),
    {
      ttl: '2m',
      swr: '30s',
      tags: tags.tenantDomain(ctx.tenantId, 'sessions'),
    },
    async () =>
      withOrgCore(ctx, async (tx) => {
        const conditions = [
          eq(sessions.gatewayId, gatewayId),
          eq(sessions.tenantId, ctx.tenantId),
          ...(agentId ? [eq(sessions.agentId, agentId)] : []),
        ];
        const rows = await tx
          .select(sessionCols)
          .from(sessions)
          .where(and(...conditions))
          .orderBy(desc(sessions.updatedAt));
        return rows.map((r) => reshape(r, serverId));
      }),
  );
}

export async function getSession(ctx: CoreCtx, id: string) {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ ...sessionCols, gatewayId: sessions.gatewayId })
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.tenantId, ctx.tenantId))),
  );

  const row = rows[0];
  if (!row) return null;
  return reshape(row, await resolveServerId(row.gatewayId));
}
