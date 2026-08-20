import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  allocateNumber,
  seedShadowSeries,
  ticketToEmission,
  resolveEmissionDocType,
  type PartyDocInfo,
} from './pos-emission.service';
import type { CoreTx } from '$server/db/with-org-core';
import { DEFAULT_IGV_RATE, resolveIgvRate } from '$server/finance/tax';
import { buildInvoiceXml, computeTotals } from '$server/finance/emission/ubl';

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
      DEFAULT_IGV_RATE,
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
      DEFAULT_IGV_RATE,
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
      DEFAULT_IGV_RATE,
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
      DEFAULT_IGV_RATE,
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
      DEFAULT_IGV_RATE,
    );
    expect(docRequired).toBe(false);
  });
});

// S2 of specs/2026-08-17-hub-igv-rate-from-org-config-spec.md: the rate an org
// configured is the rate its documents carry. These compose the REAL boundary
// (`resolveIgvRate`) with the REAL mapping and the REAL XML builder — nothing
// mocked — so a break anywhere along that path fails here.
describe('ticketToEmission — org IGV rate', () => {
  const allocation = { serie: 'B999', correlativo: 7 };
  const settings = { emission: { mode: 'shadow' as const, docTypeDefault: '03' as const } };
  // One S/118 line: at 18% that is exactly 100.00 + 18.00, at 10% it is
  // 107.27 + 10.73 — different in both buckets, so a stuck rate can't pass.
  const ticket = { subtotal: '118', total: '118' };
  const lines = [{ description: 'Servicio', qty: '1', total: '118' }];

  function emit(finSettings: { taxRate?: number | null }) {
    const { invoice } = ticketToEmission(
      ticket,
      lines,
      null,
      settings,
      allocation,
      emitter,
      resolveIgvRate(finSettings),
    );
    return { invoice, totals: computeTotals(invoice), xml: buildInvoiceXml(invoice) };
  }

  it('a non-18% configured rate drives igvRate, the totals AND the declared cbc:Percent', () => {
    const { invoice, totals, xml } = emit({ taxRate: 0.1 });
    expect(invoice.igvRate).toBe(0.1);
    expect(totals.lineExtensionAmount).toBe(107.27);
    expect(totals.igvAmount).toBe(10.73);
    expect(totals.lineExtensionAmount + totals.igvAmount).toBe(118);
    expect(xml).toContain('<cbc:Percent>10</cbc:Percent>');
    expect(xml).not.toContain('<cbc:Percent>18</cbc:Percent>');
    // The whole spec in one assertion: IGV == total * rate / (1 + rate).
    expect(totals.igvAmount).toBe(Math.round(((118 * 0.1) / 1.1) * 100) / 100);
  });

  it('an org that never configured a rate still emits at the statutory 18% (zero regression)', () => {
    const configured = emit({ taxRate: 0.18 });
    for (const absent of [{ taxRate: null }, {}]) {
      const { invoice, totals, xml } = emit(absent);
      expect(invoice.igvRate).toBe(DEFAULT_IGV_RATE);
      expect(totals.lineExtensionAmount).toBe(100);
      expect(totals.igvAmount).toBe(18);
      expect(xml).toContain('<cbc:Percent>18</cbc:Percent>');
      expect(xml).toBe(configured.xml); // byte-identical to an explicitly-18% org
    }
  });

  it('an unusable configured rate is refused before anything is emitted', () => {
    // A2 + the range guard — the emitter never sees a 0%/percent-unit rate.
    for (const taxRate of [0, 18, -0.1]) {
      expect(() => emit({ taxRate })).toThrowError(
        expect.objectContaining({ name: 'PosError', code: 'invalid_tax_rate' }),
      );
    }
  });
});
