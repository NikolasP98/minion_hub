import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const queue: unknown[][] = [];
const executed: SQL[] = [];
const tx = {
  execute: vi.fn(async (q: SQL) => {
    executed.push(q);
    return queue.shift() ?? [];
  }),
};
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_c: unknown, fn: (t: typeof tx) => unknown) => fn(tx),
}));

import { getNextOffers, rankOffers, type OfferSuggestion } from './crm-next-offers.service';

const ctx = { db: {} as never, tenantId: 'org-1' };
const dialect = new PgDialect();
const s = (name: string, coBuyers: number, unitPrice: number | null): OfferSuggestion => ({
  productId: name,
  name,
  category: null,
  unitPrice,
  coBuyers,
});

describe('rankOffers', () => {
  it('orders by co-buyers, then step-up price ascending, then the rest', () => {
    const out = rankOffers(
      [s('cheap', 0, 10), s('mid', 0, 60), s('top', 0, 90), s('popular', 3, 5), s('nil', 0, null)],
      50,
    );
    expect(out.map((o) => o.name)).toEqual(['popular', 'mid', 'top', 'cheap', 'nil']);
  });
  it('caps at 5', () => {
    expect(
      rankOffers(
        Array.from({ length: 9 }, (_, i) => s('p' + i, 0, i)),
        0,
      ),
    ).toHaveLength(5);
  });
});

describe('getNextOffers', () => {
  it('maps bought + suggestions and only reads submitted tickets / active products', async () => {
    executed.length = 0;
    queue.push(
      [{ party_id: null }],
      [{ id: 'p1', name: 'P1', qty: '2', last_at: '2026-10-01T00:00:00Z', unit_price: '50' }],
      [{ id: 'p2', name: 'P2', category: null, unit_price: '70', buyers: '3' }],
    );
    const r = await getNextOffers(ctx, 'c-x');
    expect(r.bought).toEqual([
      { productId: 'p1', name: 'P1', qty: 2, lastAt: '2026-10-01T00:00:00.000Z' },
    ]);
    expect(r.suggestions[0]).toMatchObject({ productId: 'p2', coBuyers: 3, unitPrice: 70 });
    expect(r.topSellers).toEqual([]);
    const sqlTexts = executed.map((q) => dialect.sqlToQuery(q).sql);
    expect(sqlTexts[1]).toContain("t.status = 'submitted'");
    expect(sqlTexts[2]).toContain('p.active');
  });

  it('falls back to top sellers (90d) when the contact has no history', async () => {
    executed.length = 0;
    queue.push(
      [{ party_id: null }],
      [],
      [{ id: 'p9', name: 'Best', category: 'c', unit_price: '10', buyers: '7' }],
    );
    const r = await getNextOffers(ctx, 'c-new');
    expect(r.bought).toEqual([]);
    expect(r.topSellers).toEqual([
      { productId: 'p9', name: 'Best', category: 'c', unitPrice: 10, coBuyers: 7 },
    ]);
    expect(dialect.sqlToQuery(executed[2]).sql).toContain("interval '90 days'");
  });
});
