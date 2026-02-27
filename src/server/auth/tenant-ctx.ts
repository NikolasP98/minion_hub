import { getDb } from '$server/db/client';
import { organization } from '$server/db/schema';
import type { TenantContext } from '$server/services/base';

/**
 * Resolve tenant context: use existing locals, fall back to first organization in DB.
 * Returns null only if no organization exists at all.
 */
export async function getTenantCtx(locals: App.Locals): Promise<TenantContext | null> {
	if (locals.tenantCtx) return locals.tenantCtx;
	const db = getDb();
	const rows = await db.select({ id: organization.id }).from(organization).limit(1);
	if (rows.length === 0) return null;
	return { db, tenantId: rows[0].id };
}

/**
 * Resolve tenant context, auto-creating a default organization if none exists.
 */
export async function getOrCreateTenantCtx(locals: App.Locals): Promise<TenantContext> {
	const ctx = await getTenantCtx(locals);
	if (ctx) return ctx;
	const db = getDb();
	const orgId = crypto.randomUUID();
	const now = new Date();
	await db
		.insert(organization)
		.values({ id: orgId, name: 'Default', slug: 'default', createdAt: now })
		.onConflictDoNothing();
	// Re-read in case the onConflictDoNothing fired
	const rows = await db.select({ id: organization.id }).from(organization).limit(1);
	return { db, tenantId: rows[0].id };
}
