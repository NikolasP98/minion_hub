import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { stkBins, stkItems, stkWarehouses } from '$server/db/pg-schema/stock';
import { appNotifications } from '$server/db/pg-inbox-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

/** Pure boundary check: a bin is low once `qty <= reorderLevel` — a null
 *  `reorderLevel` means the item has no reorder policy (never low). Mirrors
 *  the raw-SQL predicate `stock.service.ts`'s `stk_reorder` candidate source
 *  registers for the legacy notif engine (`b.qty <= i.reorder_level`).
 *  Exported for the unit test. */
export function isLowStock(qty: number, reorderLevel: number | null): boolean {
  if (reorderLevel == null) return false;
  return qty <= reorderLevel;
}

// shortcut: see appointment-overdue.ts — fixed Spanish strings, no per-viewer locale.
function title(itemName: string): string {
  return `Stock bajo: ${itemName}`;
}
function body(warehouseName: string, qty: string, reorderLevel: string): string {
  return `${warehouseName} · ${qty} / umbral ${reorderLevel}`;
}

/** Composite subject id — `stk_bins` has no single-column PK (org, item, warehouse). */
function binSubjectId(itemId: string, warehouseId: string): string {
  return `${itemId}:${warehouseId}`;
}

// TODO(handoff): this duplicates the `b.qty <= i.reorder_level` predicate the
// legacy notif engine already registers as the 'stk_reorder' candidate source
// (stock.service.ts ~L1114, consumed by notif.service.ts's separate
// notif_rules/notif_log pipeline via src/routes/api/notifications/tick). That
// source has no exported query function to reuse directly — it's an inline
// callback passed to registerNotifCandidateSource — so this rule re-queries
// stk_bins/stk_items/stk_warehouses directly rather than importing it. If the
// two predicates ever diverge, reconcile here and in stock.service.ts.
export const stockLowRule: Rule = {
  key: 'stock.low',
  async evaluate(ctx: CoreCtx, _now: Date): Promise<RuleResult> {
    return withOrgCore(ctx, async (tx) => {
      const low = await tx
        .select({
          itemId: stkBins.itemId,
          warehouseId: stkBins.warehouseId,
          qty: stkBins.qty,
          reorderLevel: stkItems.reorderLevel,
          itemName: stkItems.name,
          warehouseName: stkWarehouses.name,
        })
        .from(stkBins)
        .innerJoin(stkItems, eq(stkItems.id, stkBins.itemId))
        .innerJoin(stkWarehouses, eq(stkWarehouses.id, stkBins.warehouseId))
        .where(
          and(
            eq(stkBins.orgId, ctx.tenantId),
            sql`${stkItems.reorderLevel} is not null`,
            lte(stkBins.qty, stkItems.reorderLevel),
            isNull(stkItems.archivedAt),
            isNull(stkWarehouses.archivedAt),
          ),
        );

      const upserts: RuleResult['upserts'] = low.map((b) => ({
        scope: 'role',
        orgId: ctx.tenantId,
        capability: 'stock:manage',
        kind: 'stock.low',
        severity: 'warning',
        title: title(b.itemName),
        body: body(b.warehouseName, b.qty, b.reorderLevel ?? '—'),
        href: `/stock/items?item=${b.itemId}`,
        subjectType: 'stk_bin',
        subjectId: binSubjectId(b.itemId, b.warehouseId),
        dedupeKey: `stock-low:${ctx.tenantId}:${binSubjectId(b.itemId, b.warehouseId)}`,
      }));

      // Resolve: a previously-fired bin resolves once it's restocked above the
      // reorder level, the reorder policy is cleared, or the item/warehouse is
      // archived — re-check directly rather than diffing against `upserts`.
      const existing = await tx
        .select({ dedupeKey: appNotifications.dedupeKey, subjectId: appNotifications.subjectId })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'stock.low'),
            eq(appNotifications.orgId, ctx.tenantId),
            isNull(appNotifications.resolvedAt),
          ),
        );
      if (existing.length === 0) return { upserts, resolve: [] };

      const stillLow = new Set(low.map((b) => binSubjectId(b.itemId, b.warehouseId)));
      const resolve = existing
        .filter((r) => !r.subjectId || !stillLow.has(r.subjectId))
        .map((r) => r.dedupeKey)
        .filter((k): k is string => Boolean(k));
      return { upserts, resolve };
    });
  },
};
