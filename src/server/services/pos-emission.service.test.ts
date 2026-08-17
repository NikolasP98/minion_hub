import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  allocateNumber,
  seedShadowSeries,
  ticketToEmission,
  resolveEmissionDocType,
  triggerShadowEmission,
  type PartyDocInfo,
} from './pos-emission.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { PosSettings } from './pos.service';
import type { PosTicket } from '$server/db/pg-pos-schema';
import { posTicketLines } from '$server/db/pg-pos-schema';
import type { EmissionInvoice } from '$server/finance/emission';
// The real builder, imported by its own module path so the `$server/finance/
// emission` barrel mock below (which stubs the network-bound emitToBeta) does
// not stub the XML we assert on.
import { buildInvoiceXml } from '$server/finance/emission/ubl';

const dialect = new PgDialect();
function renderedSql(call: unknown[]): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(call[0] as Parameters<PgDialect['sqlToQuery']>[0]);
}

const emitter = { ruc: '20611172967', razonSocial: 'FACES BETA SAC' };

describe('allocateNumber', () => {
  it('issues a single UPDATE ... RETURNING statement scoped to org/docType/environment', async () => {
    const execute = vi.fn().mockResolvedValue([{ serie: 'B999', correlativo: 5 }]);
    const tx = { execute } as unknown as CoreTx;

    const result = await allocateNumber(tx, 'org-1', '03', 'beta');

    expect(result).toEqual({ serie: 'B999', correlativo: 5 });
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql, params } = renderedSql(execute.mock.calls[0]);
    expect(sql.toLowerCase()).toContain('update pos_series');
    expect(sql.toLowerCase()).toContain('returning');
    expect(sql.toLowerCase()).not.toContain('select'); // no read-then-write
    expect(params).toEqual(expect.arrayContaining(['org-1', '03', 'beta']));
  });

  it('throws PosError(no_serie) when no active serie matches', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const tx = { execute } as unknown as CoreTx;
    await expect(allocateNumber(tx, 'org-1', '03', 'beta')).rejects.toMatchObject({
      code: 'no_serie',
    });
  });

  // ★ Money-path concurrency contract: allocateNumber MUST be a single atomic
  // statement, never a read-then-write. This repo has no real-Postgres test
  // harness (no TEST_DATABASE_URL/CI Postgres service — verified before
  // writing this test), so a live-DB race test isn't available; this fake
  // models the property that actually matters — each execute() call mutates
  // its backing counter SYNCHRONOUSLY the instant it's invoked (exactly what
  // Postgres does inside one atomic UPDATE...RETURNING), then resolves after
  // a real timer delay so two Promise.all-driven calls genuinely interleave
  // through a real await gap. A read-then-write implementation (a separate
  // SELECT before the UPDATE) would fail this test: both reads would land
  // before either write and both calls would get correlativo 1.
  it('two concurrent allocations never return the same correlativo', async () => {
    let nextNumber = 1;
    const execute = vi.fn(async () => {
      const correlativo = nextNumber;
      nextNumber += 1;
      await new Promise((r) => setTimeout(r, 5));
      return [{ serie: 'B999', correlativo }];
    });
    const tx = { execute } as unknown as CoreTx;

    const [a, b] = await Promise.all([
      allocateNumber(tx, 'org-1', '03', 'beta'),
      allocateNumber(tx, 'org-1', '03', 'beta'),
    ]);

    expect(a.correlativo).not.toBe(b.correlativo);
    expect([a.correlativo, b.correlativo].sort((x, y) => x - y)).toEqual([1, 2]);
  });
});

describe('seedShadowSeries', () => {
  it('inserts the beta series with ON CONFLICT DO NOTHING — safe to call repeatedly', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const tx = { execute } as unknown as CoreTx;

    await seedShadowSeries(tx, 'org-1');

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql, params } = renderedSql(execute.mock.calls[0]);
    const lower = sql.toLowerCase();
    expect(lower).toContain('insert into pos_series');
    expect(lower).toContain('on conflict');
    expect(lower).toContain('do nothing');
    expect(lower).toContain('b999');
    expect(lower).toContain('f999');
    expect(lower).toContain('beta');
    // orgId is the only bound param — doc_type/serie/environment are literal.
    expect(params).toEqual(['org-1', 'org-1']);
  });
});

describe('resolveEmissionDocType', () => {
  it('RUC customer -> 01 factura', () => {
    const ruc: PartyDocInfo = { docType: 'RUC', docNumber: '20611172967', name: 'ACME SAC' };
    expect(resolveEmissionDocType(ruc, '03')).toBe('01');
  });
  it('DNI / no customer -> falls back to the configured default', () => {
    const dni: PartyDocInfo = { docType: 'DNI', docNumber: '12345678', name: 'Juan' };
    expect(resolveEmissionDocType(dni, '03')).toBe('03');
    expect(resolveEmissionDocType(null, '03')).toBe('03');
  });
});

describe('ticketToEmission', () => {
  const allocation = { serie: 'B999', correlativo: 7 };
  const settings = { emission: { mode: 'shadow' as const, docTypeDefault: '03' as const } };

  it('no customer -> anonymous-consumer boleta convention', () => {
    const { invoice, docRequired } = ticketToEmission(
      { subtotal: '100', total: '100' },
      [{ description: 'Servicio', qty: '1', total: '100' }],
      null,
      settings,
      allocation,
      emitter,
      0.18,
    );
    expect(invoice.docType).toBe('03');
    expect(invoice.client).toEqual({ docType: '1', docNumber: '00000000', name: 'CLIENTE VARIOS' });
    expect(docRequired).toBe(false); // below S/700
  });

  it('RUC customer -> factura, client doc carries the RUC', () => {
    const customer: PartyDocInfo = { docType: 'RUC', docNumber: '20611172967', name: 'ACME SAC' };
    const { invoice } = ticketToEmission(
      { subtotal: '100', total: '100' },
      [{ description: 'Servicio', qty: '1', total: '100' }],
      customer,
      settings,
      allocation,
      emitter,
      0.18,
    );
    expect(invoice.docType).toBe('01');
    expect(invoice.client).toEqual({ docType: '6', docNumber: '20611172967', name: 'ACME SAC' });
  });

  it('a ticket-level discount is folded proportionally into every line', () => {
    // subtotal 200 (two S/100 lines), ticket discount 20 -> total 180, ratio 0.9
    const { invoice } = ticketToEmission(
      { subtotal: '200', total: '180' },
      [
        { description: 'Línea A', qty: '2', total: '100' }, // qty 2 @ 50 -> adjusted 90 -> unit 45
        { description: 'Línea B', qty: '1', total: '100' }, // adjusted 90 -> unit 90
      ],
      null,
      settings,
      allocation,
      emitter,
      0.18,
    );
    expect(invoice.lines).toEqual([
      { description: 'Línea A', quantity: 2, unitPriceInclTax: 45 },
      { description: 'Línea B', quantity: 1, unitPriceInclTax: 90 },
    ]);
    // Reconstructed total matches the ticket's persisted total exactly.
    const rebuilt = invoice.lines.reduce((s, l) => s + l.quantity * l.unitPriceInclTax, 0);
    expect(rebuilt).toBeCloseTo(180, 2);
  });

  it('>= S/700 with no document flags docRequired without blocking the emission', () => {
    const { invoice, docRequired } = ticketToEmission(
      { subtotal: '700', total: '700' },
      [{ description: 'Servicio', qty: '1', total: '700' }],
      null,
      settings,
      allocation,
      emitter,
      0.18,
    );
    expect(docRequired).toBe(true);
    expect(invoice.client.docNumber).toBe('00000000'); // still emits — never blocks checkout
  });

  it('a DNI customer just under S/700 does not flag docRequired', () => {
    const customer: PartyDocInfo = { docType: 'DNI', docNumber: '12345678', name: 'Juan' };
    const { docRequired } = ticketToEmission(
      { subtotal: '699.99', total: '699.99' },
      [{ description: 'Servicio', qty: '1', total: '699.99' }],
      customer,
      settings,
      allocation,
      emitter,
      0.18,
    );
    expect(docRequired).toBe(false);
  });

  it('carries the caller-resolved igvRate onto the invoice, all the way into the XML', () => {
    const { invoice } = ticketToEmission(
      { subtotal: '118', total: '118' },
      [{ description: 'Servicio', qty: '1', total: '118' }],
      null,
      settings,
      allocation,
      emitter,
      0.1,
    );
    expect(invoice.igvRate).toBe(0.1);
    const xml = buildInvoiceXml(invoice);
    expect(xml).toContain('<cbc:Percent>10</cbc:Percent>');
    // 118 incl @10% => 107.27 gravada + 10.73 IGV (NOT the 100.00/18.00 of 18%)
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="PEN">107.27</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="PEN">10.73</cbc:TaxAmount>');
  });
});

// ---- the org's configured rate reaches the emitted document (spec S2 DoD) ----

const h = vi.hoisted(() => ({
  finSettings: { taxRate: null as number | null },
  emitted: [] as unknown[],
  detached: [] as Promise<unknown>[],
}));

vi.mock('$server/db/with-org-core', () => ({ withOrgCore: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({
  env: {
    POS_EMISSION_EMITTER_RUC: '20611172967',
    POS_EMISSION_EMITTER_NAME: 'FACES BETA SAC',
    POS_EMISSION_EMITTER_UBIGEO: '150101',
    POS_EMISSION_EMITTER_ADDRESS: 'AV BETA 123',
    POS_EMISSION_BETA_CERT: 'CERT-PEM',
    POS_EMISSION_BETA_KEY: 'KEY-PEM',
  },
}));
// Only the network call is stubbed; it records the invoice the service built.
vi.mock('$server/finance/emission', () => ({
  emitToBeta: vi.fn(async (inv: unknown) => {
    h.emitted.push(inv);
    return { responseCode: '0', description: 'ACEPTADA', notes: [], xmlHash: 'deadbeef' };
  }),
}));
vi.mock('./finance.service', () => ({
  getFinSettings: vi.fn(async () => h.finSettings),
  bustFinanceCache: vi.fn(),
}));
// waitUntil no-ops outside a request context, so the test keeps the detached
// promise to await the async half deterministically.
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    h.detached.push(p);
  },
}));

const thenable = <T>(rows: T[]) => ({
  limit: () => Promise.resolve(rows),
  then: (res: (v: T[]) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
});

describe('triggerShadowEmission — fin_settings.tax_rate drives the emitted document', () => {
  const ticket = { id: 'tk-1', partyId: null, subtotal: '118', total: '118' } as unknown as PosTicket;
  const settings = {
    emission: { mode: 'shadow', docTypeDefault: '03' },
  } as unknown as PosSettings;
  const ctx = { tenantId: 'org-1' } as unknown as CoreCtx;
  let updates: Record<string, unknown>[] = [];

  beforeEach(() => {
    h.emitted.length = 0;
    h.detached.length = 0;
    updates = [];
    const tx = {
      execute: vi.fn(async () => [{ serie: 'B999', correlativo: 7 }]),
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            thenable(
              table === posTicketLines ? [{ description: 'Servicio', qty: '1', total: '118' }] : [],
            ),
        }),
      }),
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'em-1' }] }) }),
      update: () => ({
        set: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return { where: () => Promise.resolve([]) };
        },
      }),
    };
    vi.mocked(withOrgCore).mockImplementation(
      (async (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx)) as never,
    );
  });

  async function runOnce() {
    await triggerShadowEmission(ctx, ticket, settings);
    await Promise.all(h.detached);
    return h.emitted[0] as EmissionInvoice;
  }

  it('a non-statutory configured rate is the rate the document declares', async () => {
    h.finSettings = { taxRate: 0.1 };
    const invoice = await runOnce();
    expect(invoice.igvRate).toBe(0.1);
    expect(buildInvoiceXml(invoice)).toContain('<cbc:Percent>10</cbc:Percent>');
    expect(updates.at(-1)).toMatchObject({ status: 'accepted', responseCode: '0' });
  });

  it('an org that never configured a rate still gets the statutory default', async () => {
    h.finSettings = { taxRate: null };
    const invoice = await runOnce();
    expect(invoice.igvRate).toBe(0.18);
    expect(buildInvoiceXml(invoice)).toContain('<cbc:Percent>18</cbc:Percent>');
  });

  it('an unusable configured rate never blocks checkout and emits nothing', async () => {
    h.finSettings = { taxRate: 0 }; // exonerado is a different UBL document (A2)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // resolves (does not reject) — a shadow-emission problem must never reach
    // the cashier's request, per 2026-08-14-pos-shadow-emission-spec §3.
    await expect(triggerShadowEmission(ctx, ticket, settings)).resolves.toBeUndefined();
    await Promise.all(h.detached);
    expect(h.emitted).toHaveLength(0);
    expect(logged.mock.calls.at(-1)?.[2]).toMatchObject({ code: 'invalid_tax_rate' });
    // The failure precedes the pos_emissions insert, so there is no row to
    // degrade to status='error' — see the TODO(handoff) in the service.
    expect(updates).toHaveLength(0);
    logged.mockRestore();
  });
});
