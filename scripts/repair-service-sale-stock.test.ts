import { describe, it, expect } from 'vitest';
import { planOrg, type Candidate } from './repair-service-sale-stock';

const m = (o: Record<string, number>) => new Map(Object.entries(o));
const sale = (n: number): Candidate => ({
  ticketId: `t${n}`,
  sale: `POS-${n}`,
  movement: `STE-${n}`,
});

/** The real pure planner is exercised in pos.tickets.test.ts; this fake keeps
 *  the same contract so the script's own bookkeeping is what is under test. */
const planRepost = (
  oldByItem: Map<string, number>,
  newByItem: Map<string, number>,
  opts: { allowedItemIds: Set<string> },
) => {
  const changes = [...oldByItem]
    .map(([itemId, old]) => ({ itemId, old, new: newByItem.get(itemId) ?? 0 }))
    .map((c) => ({ ...c, diff: c.new - c.old }))
    .filter((c) => c.diff !== 0);
  return { changes, drift: changes.filter((c) => !opts.allowedItemIds.has(c.itemId)) };
};

const previews: Record<string, unknown> = {
  // treatment supply issued at the sale: planned for return
  t1: {
    oldByItem: m({ prod: 1, syringe: 1 }),
    newByItem: m({ prod: 1 }),
    serviceItemIds: new Set(['syringe']),
  },
  // already correct
  t2: {
    oldByItem: m({ prod: 1 }),
    newByItem: m({ prod: 1 }),
    serviceItemIds: new Set(['syringe']),
  },
  // a product item would change: refused
  t3: {
    oldByItem: m({ prod: 2 }),
    newByItem: m({ prod: 1 }),
    serviceItemIds: new Set(['syringe']),
  },
  t5: { oldByItem: m({ syringe: 2 }), newByItem: m({}), serviceItemIds: new Set(['syringe']) },
};
const deps = {
  previewTicketRepost: async (_ctx: unknown, id: string) => {
    if (!previews[id]) throw Object.assign(new Error('none'), { code: 'no_stock_entry' });
    return previews[id];
  },
  planRepost,
} as unknown as Parameters<typeof planOrg>[0];

describe('repair-service-sale-stock — planOrg', () => {
  it('plans treatment supplies for return, refuses product changes, skips sales with no movement', async () => {
    const plan = await planOrg(deps, {} as never, [1, 2, 3, 4, 5].map(sale));

    expect(plan.rows.map((r) => [r.sale, r.itemId, r.diff])).toEqual([
      ['POS-1', 'syringe', -1],
      ['POS-5', 'syringe', -2],
    ]);
    expect(plan.refused.map((r) => r.sale)).toEqual(['POS-3']);
    expect(plan.skipped).toEqual([{ ...sale(4), reason: 'no_stock_entry' }]);
    expect([...plan.totals]).toEqual([['syringe', -3]]);
  });
});
