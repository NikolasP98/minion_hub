import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { CoreTx } from '$server/db/with-org-core';

// `emitShiftTickets` — the shift close's commit point to SUNAT (spec
// 2026-10-15-hub-pos-shift-scoped-edits-and-emission-on-close T2/I5). The DB
// double answers the service's reads in order; every assertion is on what the
// service decided to hand to the emitter and on the SQL it filtered with.
const results: unknown[][] = [];
const whereConds: unknown[] = [];
const dialect = new PgDialect();
const fakeTx = () => {
  const next = () => results.shift() ?? [];
  const terminal = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), { orderBy: () => Promise.resolve(rows) });
  const chain = {
    select: () => chain,
    from: () => chain,
    where: (cond: unknown) => {
      whereConds.push(cond);
      return terminal(next());
    },
  };
  return chain as unknown as CoreTx;
};
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: CoreCtx, fn: (tx: CoreTx) => unknown) => fn(fakeTx()),
}));
const trigger = vi.fn<(ctx: unknown, ticket: { id: string }, settings: unknown) => Promise<void>>(
  async () => undefined,
);
vi.mock('./pos-emission.service', () => ({
  triggerShadowEmission: (ctx: unknown, ticket: { id: string }, settings: unknown) =>
    trigger(ctx, ticket, settings),
  listEmissionsForTicket: vi.fn(async () => []),
  emissionStatusByTicket: vi.fn(async () => ({})),
  seedShadowSeries: vi.fn(),
}));
const settings = {
  currency: 'PEN',
  methods: [
    { id: 'cash', label: 'Efectivo', enabled: true, takesTendered: true, sunat: true },
    { id: 'transfer', label: 'Transferencia', enabled: true, takesTendered: false, sunat: false },
  ],
  emission: { mode: 'shadow', docTypeDefault: '03' },
};
const getPosSettings = vi.fn(async () => settings);
vi.mock('./pos/settings', async (orig) => ({
  ...(await orig<typeof import('./pos/settings')>()),
  getPosSettings: () => getPosSettings(),
}));

const ctx = { db: {} as never, tenantId: 'org-1' } as CoreCtx;
const ticket = (id: string) => ({
  id,
  orgId: 'org-1',
  status: 'submitted',
  subtotal: '100.00',
  discount: '0.00',
  total: '100.00',
  currency: 'PEN',
});

beforeEach(() => {
  results.length = 0;
  whereConds.length = 0;
  trigger.mockClear();
  getPosSettings.mockResolvedValue(settings);
});

describe('emitShiftTickets', () => {
  it('hands every live, not-yet-emitted ticket to the emitter and skips non-SUNAT tenders', async () => {
    const { emitShiftTickets } = await import('./pos.service');
    results.push(
      [ticket('t1'), ticket('t2'), ticket('t3')],
      [
        { ticketId: 't1', method: 'cash' },
        { ticketId: 't2', method: 'cash' },
        { ticketId: 't2', method: 'transfer' }, // one excluded tender keeps the whole ticket out
        { ticketId: 't3', method: 'cash' },
      ],
    );

    const batch = await emitShiftTickets(ctx, 'shift-1');

    expect(batch).toEqual({ queued: 2, skipped: 1 });
    expect(trigger.mock.calls.map((c) => c[1].id)).toEqual(['t1', 't3']);
  });

  it('reads only tickets without an accepted/pending/rejected row — a retry re-sends errors, never duplicates (I5)', async () => {
    const { emitShiftTickets } = await import('./pos.service');
    results.push([]);

    await emitShiftTickets(ctx, 'shift-1');

    const { sql } = dialect.sqlToQuery(whereConds[0] as Parameters<PgDialect['sqlToQuery']>[0]);
    const lower = sql.toLowerCase();
    expect(lower).toContain('not exists');
    expect(lower).toContain("e.status <> 'error'");
    expect(lower).toContain('<> ');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('is a no-op while emission is off — no ticket read, nothing emitted', async () => {
    const { emitShiftTickets } = await import('./pos.service');
    getPosSettings.mockResolvedValue({
      ...settings,
      emission: { mode: 'off', docTypeDefault: '03' },
    });

    expect(await emitShiftTickets(ctx, 'shift-1')).toEqual({ queued: 0, skipped: 0 });
    expect(whereConds).toHaveLength(0);
    expect(trigger).not.toHaveBeenCalled();
  });
});
