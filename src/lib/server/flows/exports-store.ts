import { eq, and } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { flowVarExports } from '$server/db/pg-flow-exports-schema';

const scope = (ctx: CoreCtx) => ({ db: getCoreDb(), tenantId: ctx.tenantId });

export function listExportToggles(ctx: CoreCtx, flowId: string): Promise<Record<string, boolean>> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx
      .select({ varKey: flowVarExports.varKey, enabled: flowVarExports.enabled })
      .from(flowVarExports)
      .where(and(eq(flowVarExports.orgId, ctx.tenantId), eq(flowVarExports.flowId, flowId)));
    return Object.fromEntries(rows.map((r) => [r.varKey, r.enabled]));
  });
}

export function setExportToggle(ctx: CoreCtx, flowId: string, varKey: string, enabled: boolean): Promise<void> {
  return withOrgCore(scope(ctx), async (tx) => {
    await tx
      .insert(flowVarExports)
      .values({ orgId: ctx.tenantId, flowId, varKey, enabled })
      .onConflictDoUpdate({
        target: [flowVarExports.orgId, flowVarExports.flowId, flowVarExports.varKey],
        set: { enabled, updatedAt: new Date() },
      });
  });
}
