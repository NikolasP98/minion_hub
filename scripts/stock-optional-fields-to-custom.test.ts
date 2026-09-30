import { describe, expect, it } from 'vitest';
import { planOrgBackfill, type StockItemRow } from './stock-optional-fields-to-custom';

function item(overrides: Partial<StockItemRow>): StockItemRow {
  return {
    itemId: crypto.randomUUID(),
    code: 'ITEM',
    name: 'Item',
    itemGroup: null,
    reorderQty: null,
    moq: null,
    ...overrides,
  };
}

describe('planOrgBackfill', () => {
  it('produces nothing for an all-null (fresh) org', () => {
    const plan = planOrgBackfill([item({}), item({})]);
    expect(plan.definitionsNeeded).toEqual([]);
    expect(plan.valuesToWrite).toEqual([]);
  });

  it('produces nothing for an empty item list', () => {
    const plan = planOrgBackfill([]);
    expect(plan.definitionsNeeded).toEqual([]);
    expect(plan.valuesToWrite).toEqual([]);
  });

  it('only requests definitions for columns that actually have values', () => {
    const plan = planOrgBackfill([item({ moq: 5 })]);
    expect(plan.definitionsNeeded.map((d) => d.key)).toEqual(['moq']);
    expect(plan.valuesToWrite).toEqual([{ key: 'moq', itemId: expect.any(String), rawValue: 5 }]);
  });

  it('dedupes duplicate item_group values into one option each', () => {
    const a = item({ itemGroup: 'Retail' });
    const b = item({ itemGroup: 'Retail' });
    const c = item({ itemGroup: 'Wholesale' });
    const plan = planOrgBackfill([a, b, c]);
    const groupDef = plan.definitionsNeeded.find((d) => d.key === 'group');
    expect(groupDef?.rules.type).toBe('select');
    const options = groupDef!.rules.type === 'select' ? groupDef.rules.options : [];
    expect(options.map((o) => o.label)).toEqual(['Retail', 'Wholesale']);
    // one option per distinct label — ids unique, no duplicate option per value
    expect(new Set(options.map((o) => o.id)).size).toBe(2);
    const groupWrites = plan.valuesToWrite.filter((v) => v.key === 'group');
    expect(groupWrites).toEqual([
      { key: 'group', itemId: a.itemId, rawValue: 'Retail' },
      { key: 'group', itemId: b.itemId, rawValue: 'Retail' },
      { key: 'group', itemId: c.itemId, rawValue: 'Wholesale' },
    ]);
  });

  it('handles a mix of null/non-null across all three columns for one item', () => {
    const row = item({ itemGroup: 'Retail', reorderQty: 10, moq: null });
    const plan = planOrgBackfill([row]);
    expect(plan.definitionsNeeded.map((d) => d.key).sort()).toEqual(['group', 'reorderQty']);
    expect(plan.valuesToWrite).toEqual([
      { key: 'group', itemId: row.itemId, rawValue: 'Retail' },
      { key: 'reorderQty', itemId: row.itemId, rawValue: 10 },
    ]);
  });

  it('treats each org call independently (multi-org handled by the caller)', () => {
    const orgAItems = [item({ moq: 1 })];
    const orgBItems = [item({})]; // all-null org
    const planA = planOrgBackfill(orgAItems);
    const planB = planOrgBackfill(orgBItems);
    expect(planA.definitionsNeeded.map((d) => d.key)).toEqual(['moq']);
    expect(planB.definitionsNeeded).toEqual([]);
  });

  it('ignores blank-string item_group as if it were null', () => {
    const plan = planOrgBackfill([item({ itemGroup: '   ' })]);
    expect(plan.definitionsNeeded).toEqual([]);
    expect(plan.valuesToWrite).toEqual([]);
  });
});
