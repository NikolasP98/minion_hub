import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { gatewayHeartbeats } from '$server/db/schema';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);

  const { db, tenantId } = locals.tenantCtx;
  const serverId = url.searchParams.get('serverId') ?? undefined;
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 100;

  const conditions = [eq(gatewayHeartbeats.tenantId, tenantId)];
  if (serverId) conditions.push(eq(gatewayHeartbeats.serverId, serverId));
  if (from) conditions.push(gte(gatewayHeartbeats.capturedAt, from));
  if (to) conditions.push(lte(gatewayHeartbeats.capturedAt, to));

  const heartbeats = await db
    .select()
    .from(gatewayHeartbeats)
    .where(and(...conditions))
    .orderBy(desc(gatewayHeartbeats.capturedAt))
    .limit(limit);

  return json({ heartbeats });
};
