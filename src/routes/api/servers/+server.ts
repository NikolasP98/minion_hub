import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listServers, upsertServer } from '$server/services/server.service';
import { getDb } from '$server/db/client';
import { tenants } from '$server/db/schema';
import type { TenantContext } from '$server/services/base';

async function getTenantCtx(locals: App.Locals): Promise<TenantContext | null> {
  if (locals.tenantCtx) return locals.tenantCtx;
  // Fall back to first tenant for unauthenticated local usage
  const db = getDb();
  const rows = await db.select({ id: tenants.id }).from(tenants).limit(1);
  if (rows.length === 0) return null;
  return { db, tenantId: rows[0].id };
}

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) return json({ servers: [] });
  try {
    const servers = await listServers(ctx);
    return json({ servers });
  } catch {
    return json({ servers: [] });
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'No tenant configured');
  try {
    const body = await request.json();
    await upsertServer(ctx, body);
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
