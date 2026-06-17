import { and, eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { appModules } from '$server/db/pg-modules-schema';

export function resolveEnabled(rows: { moduleId: string; enabled: boolean }[], moduleId: string): boolean {
  const row = rows.find((r) => r.moduleId === moduleId);
  return row ? row.enabled : true; // absent = enabled
}

export async function listModuleStates(ctx: CoreCtx): Promise<Record<string, boolean>> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx.select({ moduleId: appModules.moduleId, enabled: appModules.enabled })
      .from(appModules).where(eq(appModules.orgId, ctx.tenantId)),
  );
  return Object.fromEntries(rows.map((r) => [r.moduleId, r.enabled]));
}

export async function isModuleEnabled(ctx: CoreCtx, moduleId: string): Promise<boolean> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx.select({ moduleId: appModules.moduleId, enabled: appModules.enabled })
      .from(appModules).where(and(eq(appModules.orgId, ctx.tenantId), eq(appModules.moduleId, moduleId))),
  );
  return resolveEnabled(rows, moduleId);
}

export async function bothEnabled(ctx: CoreCtx, a: string, b: string): Promise<boolean> {
  const states = await listModuleStates(ctx);
  return resolveEnabled(Object.entries(states).map(([moduleId, enabled]) => ({ moduleId, enabled })), a)
    && resolveEnabled(Object.entries(states).map(([moduleId, enabled]) => ({ moduleId, enabled })), b);
}

export async function setModuleEnabled(ctx: CoreCtx, moduleId: string, enabled: boolean): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.insert(appModules).values({ orgId: ctx.tenantId, moduleId, enabled, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [appModules.orgId, appModules.moduleId], set: { enabled, updatedAt: new Date() } }),
  );
}
