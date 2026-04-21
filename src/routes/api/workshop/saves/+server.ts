import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { workshopSaves } from '@minion-stack/db/schema';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  // Return saves owned by this user OR legacy saves with no owner (admin-visible only)
  const rows = await ctx.db
    .select()
    .from(workshopSaves)
    .where(
      and(
        or(eq(workshopSaves.userId, user.id), isNull(workshopSaves.userId)),
        or(eq(workshopSaves.tenantId, ctx.tenantId), isNull(workshopSaves.tenantId)),
      ),
    )
    .orderBy(desc(workshopSaves.updatedAt));

  const saves = rows.map((row) => {
    let agentCount = 0;
    let elementCount = 0;
    try {
      const s = JSON.parse(row.state);
      agentCount = Object.keys(s.agents ?? {}).length;
      elementCount = Object.keys(s.elements ?? {}).length;
    } catch {
      // non-critical — leave counts at 0
    }
    return {
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      thumbnail: row.thumbnail ?? null,
      agentCount,
      elementCount,
    };
  });

  return json({ saves });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const body = await request.json();
  const { name, state, thumbnail } = body as { name?: string; state?: string; thumbnail?: string };

  if (!name || typeof name !== 'string') throw error(400, 'name is required');
  if (!state || typeof state !== 'string') throw error(400, 'state is required');

  // Validate that state is valid JSON
  try {
    JSON.parse(state);
  } catch {
    throw error(400, 'state must be valid JSON');
  }

  const id = randomUUID();
  const now = Date.now();

  try {
    await ctx.db.insert(workshopSaves).values({
      id,
      name,
      state,
      thumbnail: typeof thumbnail === 'string' ? thumbnail : null,
      userId: user.id,
      tenantId: ctx.tenantId,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    console.error('[workshop saves POST] db insert failed:', err);
    throw error(
      500,
      `Failed to save workspace: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return json({ id, ok: true });
};
