import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { upsertServer, deleteServer } from '$server/services/server.service';
import { getDb } from '$server/db/client';
import { tenants } from '$server/db/schema';
import type { TenantContext } from '$server/services/base';

async function getTenantCtx(locals: App.Locals): Promise<TenantContext | null> {
  if (locals.tenantCtx) return locals.tenantCtx;
  const db = getDb();
  const rows = await db.select({ id: tenants.id }).from(tenants).limit(1);
  if (rows.length === 0) return null;
  return { db, tenantId: rows[0].id };
}

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'No tenant configured');
  try {
    const body = await request.json();
    const id = params.id!;
    await upsertServer(ctx, { id, name: '', url: '', token: '', ...body });
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'No tenant configured');
  try {
    await deleteServer(ctx, params.id!);
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
