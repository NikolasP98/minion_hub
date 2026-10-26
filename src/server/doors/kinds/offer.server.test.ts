import { describe, expect, it, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const modules = vi.hoisted(() => ({ scheduling: true }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: { db: unknown }, fn: (tx: unknown) => unknown) => fn(ctx.db),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: async (_ctx: unknown, id: string) => id !== 'scheduling' || modules.scheduling,
}));

import { publicView } from './offer.server';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { DoorRow } from '$lib/doors/types';

const A = '11111111-2222-4333-8444-555555555555';
const B = '22222222-2222-4333-8444-555555555555';
const FOREIGN = '33333333-2222-4333-8444-555555555555';
const LINK = '44444444-2222-4333-8444-555555555555';

const door = (config: unknown): DoorRow =>
  ({ id: 'd', orgId: 'org-1', kind: 'offer', config }) as DoorRow;
const run = (rows: unknown[], config: unknown) => {
  const { db, resolveSequence } = createMockDb();
  resolveSequence(rows);
  return publicView({ db, tenantId: 'org-1' } as unknown as CoreCtx, door(config));
};

describe('offer publicView', () => {
  it('returns live prices in config order, only public fields, digits-only wa.me', async () => {
    const v = await run(
      [
        [
          { id: B, name: 'Beta', category: null, unitPrice: '20.50' },
          { id: A, name: 'Alfa', category: 'Cat', unitPrice: '10' },
        ],
        [{ currency: 'USD' }],
        [{ slug: 'reservas' }],
      ],
      { productIds: [A, B], whatsappNumber: '+51 (900) 000-000', bookingLinkId: LINK },
    );
    expect(v).toEqual({
      items: [
        { name: 'Alfa', category: 'Cat', price: 10 },
        { name: 'Beta', category: null, price: 20.5 },
      ],
      currency: 'USD',
      waUrl: 'https://wa.me/51900000000',
      bookingSlug: 'reservas',
    });
  });

  it('omits ids the query did not return (inactive or foreign org), a bad number and an inactive link', async () => {
    const v = await run([[{ id: A, name: 'Alfa', category: null, unitPrice: null }], [], []], {
      productIds: [FOREIGN, A],
      whatsappNumber: 'abc',
      bookingLinkId: LINK,
    });
    expect(v).toEqual({
      items: [{ name: 'Alfa', category: null, price: null }],
      currency: 'PEN',
      waUrl: null,
      bookingSlug: null,
    });
  });

  it('hides Reservar when the org has the scheduling module off', async () => {
    modules.scheduling = false;
    try {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([[{ id: A, name: 'Alfa', category: null, unitPrice: '10' }], []]);
      const v = await publicView(
        { db, tenantId: 'org-1' } as unknown as CoreCtx,
        door({ productIds: [A], whatsappNumber: '', bookingLinkId: LINK }),
      );
      expect(v.bookingSlug).toBeNull();
      expect(db.select).toHaveBeenCalledTimes(2); // products + settings; the link is never read
    } finally {
      modules.scheduling = true;
    }
  });

  it('returns an empty view for an invalid stored config', async () => {
    const v = await run([], { productIds: 'x' });
    expect(v.items).toEqual([]);
  });
});
