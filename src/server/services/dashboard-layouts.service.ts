import { and, eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { dashboardLayouts } from '$server/db/pg-dashboard-schema';
import type { CoreCtx } from '$server/auth/core-ctx';

/** The persisted layout blob (mirrors EditableGrid's GridLayout). */
export interface DashboardLayout {
  order: string[];
  span: Record<string, { w: number; h: number }>;
}

/** Read the org's pinned default layout for a dashboard (null = none set). */
export async function getDefaultLayout(
  ctx: CoreCtx,
  dashboardId: string,
): Promise<DashboardLayout | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ layout: dashboardLayouts.layout })
      .from(dashboardLayouts)
      .where(and(eq(dashboardLayouts.orgId, ctx.tenantId), eq(dashboardLayouts.dashboardId, dashboardId)))
      .limit(1),
  );
  const v = row?.layout as Partial<DashboardLayout> | undefined;
  return v && Array.isArray(v.order) && v.span ? (v as DashboardLayout) : null;
}

/** Admin-only: pin the org default layout for a dashboard (upsert). */
export async function setDefaultLayout(
  ctx: CoreCtx,
  dashboardId: string,
  layout: DashboardLayout,
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(dashboardLayouts)
      .values({ orgId: ctx.tenantId, dashboardId, layout, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [dashboardLayouts.orgId, dashboardLayouts.dashboardId],
        set: { layout, updatedAt: new Date() },
      }),
  );
}
