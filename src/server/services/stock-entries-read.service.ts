/**
 * Read-only helpers for `/stock/entries`' outer list columns. Split out of
 * `stock.service.ts` (owned by another in-flight bundle) so a batched line
 * count + first-line warehouse pair costs ONE round trip for the whole page
 * instead of a `getEntry` per row.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { stkEntryLines } from '$server/db/pg-schema/stock';

export interface EntryLineSummary {
  lineCount: number;
  firstFromWarehouseId: string | null;
  firstToWarehouseId: string | null;
}

/**
 * One grouped count query + one ordered-by-lineNo scan (ids/warehouse ids
 * only, no qty/rate) to take the first line per entry. Org scale here is
 * hundreds of entries with a handful of lines each — cheap either way.
 * ponytail: a `DISTINCT ON` would do this in one query; two plain queries
 * keep this file boring. Revisit if entry line counts grow large.
 */
export async function listEntryLineSummaries(
  ctx: CoreCtx,
  entryIds: string[],
): Promise<Map<string, EntryLineSummary>> {
  const unique = [...new Set(entryIds)];
  const result = new Map<string, EntryLineSummary>();
  if (!unique.length) return result;

  return withOrgCore(ctx, async (tx) => {
    const counts = await tx
      .select({ entryId: stkEntryLines.entryId, count: sql<number>`count(*)::int` })
      .from(stkEntryLines)
      .where(and(eq(stkEntryLines.orgId, ctx.tenantId), inArray(stkEntryLines.entryId, unique)))
      .groupBy(stkEntryLines.entryId);

    const lines = await tx
      .select({
        entryId: stkEntryLines.entryId,
        fromWarehouseId: stkEntryLines.fromWarehouseId,
        toWarehouseId: stkEntryLines.toWarehouseId,
      })
      .from(stkEntryLines)
      .where(and(eq(stkEntryLines.orgId, ctx.tenantId), inArray(stkEntryLines.entryId, unique)))
      .orderBy(asc(stkEntryLines.lineNo));

    const firstByEntry = new Map<
      string,
      { fromWarehouseId: string | null; toWarehouseId: string | null }
    >();
    for (const row of lines) {
      if (!firstByEntry.has(row.entryId)) firstByEntry.set(row.entryId, row);
    }
    const countByEntry = new Map(counts.map((c) => [c.entryId, c.count]));

    for (const id of unique) {
      const first = firstByEntry.get(id);
      result.set(id, {
        lineCount: countByEntry.get(id) ?? 0,
        firstFromWarehouseId: first?.fromWarehouseId ?? null,
        firstToWarehouseId: first?.toWarehouseId ?? null,
      });
    }
    return result;
  });
}
