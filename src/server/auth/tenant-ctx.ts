import { getDb } from '$server/db/client';
import { tenants } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from '$server/services/base';

/**
 * Resolve tenant context: use existing locals, fall back to first tenant in DB.
 * Returns null only if no tenant exists at all.
 */
export async function getTenantCtx(locals: App.Locals): Promise<TenantContext | null> {
	if (locals.tenantCtx) return locals.tenantCtx;
	const db = getDb();
	const rows = await db.select({ id: tenants.id }).from(tenants).limit(1);
	if (rows.length === 0) return null;
	return { db, tenantId: rows[0].id };
}

/**
 * Resolve tenant context, auto-creating a default tenant if none exists.
 * Uses onConflictDoNothing on slug to survive the unique constraint
 * when a seeded tenant already exists.
 */
export async function getOrCreateTenantCtx(locals: App.Locals): Promise<TenantContext> {
	const ctx = await getTenantCtx(locals);
	if (ctx) return ctx;
	const db = getDb();
	const tenantId = newId();
	const now = nowMs();
	await db
		.insert(tenants)
		.values({ id: tenantId, name: 'Default', slug: 'default', createdAt: now, updatedAt: now })
		.onConflictDoNothing();
	// Re-read: if onConflictDoNothing fired, we need the existing row's ID
	const rows = await db.select({ id: tenants.id }).from(tenants).limit(1);
	return { db, tenantId: rows[0].id };
}
