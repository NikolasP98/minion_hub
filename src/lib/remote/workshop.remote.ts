/**
 * Remote functions for workshop saves (consumed by workshop.svelte.ts).
 * Mirrors `/api/workshop/saves` + `/api/workshop/saves/[id]`, including the
 * per-row ownership rules (own row, or legacy null-owner within the tenant).
 */
import { query, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { currentUser, currentTenantCtx } from '$server/remote/guard';
import { workshopSaves } from '@minion-stack/db/schema';
import type { TenantContext } from '$server/services/base';

async function requireSaveOwnership(
  userId: string,
  tenantId: string,
  saveId: string,
  ctx: TenantContext,
) {
  const [save] = await ctx.db.select().from(workshopSaves).where(eq(workshopSaves.id, saveId));
  if (!save) error(404, 'Save not found');
  const ownedByUser = save.userId === userId;
  const legacyRow = save.userId === null;
  const sameTenant = save.tenantId === tenantId || save.tenantId === null;
  if ((!ownedByUser && !legacyRow) || !sameTenant) error(403, 'Forbidden');
  return save;
}

/** Saves owned by the current user (or legacy null-owner rows in-tenant). */
export const listWorkshopSaves = query(async () => {
  const user = currentUser();
  const ctx = await currentTenantCtx();
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

  return rows.map((row) => {
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
});

/** One save with its parsed state. */
export const getWorkshopSave = query(z.string().min(1), async (id) => {
  const user = currentUser();
  const ctx = await currentTenantCtx();
  const save = await requireSaveOwnership(user.id, ctx.tenantId, id, ctx);
  return { ...save, state: JSON.parse(save.state) as unknown };
});

function assertJson(state: string) {
  try {
    JSON.parse(state);
  } catch {
    error(400, 'state must be valid JSON');
  }
}

/** Create a new save. Returns its id. */
export const createWorkshopSave = command(
  z.object({
    name: z.string().min(1),
    state: z.string().min(1),
    thumbnail: z.string().optional(),
  }),
  async ({ name, state, thumbnail }) => {
    const user = currentUser();
    const ctx = await currentTenantCtx();
    assertJson(state);
    const id = randomUUID();
    const now = Date.now();
    await ctx.db.insert(workshopSaves).values({
      id,
      name,
      state,
      thumbnail: thumbnail ?? null,
      userId: user.id,
      tenantId: ctx.tenantId,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  },
);

/** Update a save's name/state/thumbnail. */
export const updateWorkshopSave = command(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    state: z.string().optional(),
    thumbnail: z.string().nullable().optional(),
  }),
  async ({ id, name, state, thumbnail }) => {
    const user = currentUser();
    const ctx = await currentTenantCtx();
    const existing = await requireSaveOwnership(user.id, ctx.tenantId, id, ctx);

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (name !== undefined) updates.name = name;
    if (state !== undefined) {
      assertJson(state);
      updates.state = state;
    }
    if (thumbnail !== undefined) updates.thumbnail = thumbnail ?? null;

    await ctx.db.update(workshopSaves).set(updates).where(eq(workshopSaves.id, existing.id));
    return { ok: true as const };
  },
);

/** Delete a save. */
export const deleteWorkshopSave = command(z.string().min(1), async (id) => {
  const user = currentUser();
  const ctx = await currentTenantCtx();
  const existing = await requireSaveOwnership(user.id, ctx.tenantId, id, ctx);
  await ctx.db.delete(workshopSaves).where(eq(workshopSaves.id, existing.id));
  return { ok: true as const };
});
