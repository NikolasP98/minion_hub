import { describe, expect, it } from 'vitest';
import { bajaId, buildBajaXml, buildResumenXml, resumenId, type BajaLine, type ResumenLine } from './summary';
import type { EmissionInvoice } from './types';

const boleta: EmissionInvoice = {
  docType: '03',
  serie: 'B998',
  correlativo: '1',
  issueDate: '2026-08-14',
  currency: 'PEN',
  igvRate: 0.18,
  emitter: { ruc: '20611172967', razonSocial: 'FACES BETA SAC', ubigeo: '150101', address: 'AV BETA 123' },
  client: { docType: '1', docNumber: '12345678', name: 'CLIENTE DE PRUEBA' },
  lines: [{ description: 'Servicio de prueba', quantity: 1, unitPriceInclTax: 118 }],
};

const emitter = { ruc: '20611172967', razonSocial: 'FACES BETA SAC' };

describe('resumenId / bajaId', () => {
  it('follow the RC/RA-YYYYMMDD-N naming law from the resumen/baja own IssueDate', () => {
    expect(resumenId('2026-08-14', '1')).toBe('RC-20260814-1');
    expect(bajaId('2026-08-14', '7')).toBe('RA-20260814-7');
  });
});

describe('buildResumenXml', () => {
  const lines: ResumenLine[] = [{ invoice: boleta, estado: '1' }];

  it('builds a well-formed RC with id, dates, and one SummaryDocumentsLine per boleta', () => {
    const xml = buildResumenXml({ emitter, correlativo: '1', referenceDate: '2026-08-14', issueDate: '2026-08-14', lines });
    expect(xml).toContain('<cbc:ID>RC-20260814-1</cbc:ID>');
    expect(xml).toContain('<cbc:ReferenceDate>2026-08-14</cbc:ReferenceDate>');
    expect(xml).toContain('<cbc:IssueDate>2026-08-14</cbc:IssueDate>');
    expect(xml).toContain('<cbc:ID>B998-1</cbc:ID>'); // the line's serie-numero
    expect(xml).toContain('<cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>');
    expect(xml).toContain('<cbc:ConditionCode>1</cbc:ConditionCode>');
    expect(xml).toContain('<cbc:CustomerAssignedAccountID>12345678</cbc:CustomerAssignedAccountID>');
    expect(xml).toContain('<sac:TotalAmount currencyID="PEN">118.00</sac:TotalAmount>');
    expect(xml).toContain('<cbc:URI>#SignatureSP</cbc:URI>');
    expect(xml).toMatch(/<sac:SummaryDocumentsLine>/);
  });

  it('derives per-line gravada/IGV from computeTotals, not accepted input', () => {
    const xml = buildResumenXml({ emitter, correlativo: '1', referenceDate: '2026-08-14', issueDate: '2026-08-14', lines });
    // 118 incl tax @18% => 100.00 gravada + 18.00 IGV
    expect(xml).toContain('<cbc:PaidAmount currencyID="PEN">100.00</cbc:PaidAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="PEN">18.00</cbc:TaxAmount>');
  });

  it('supports multiple lines with distinct estado (e.g. one anulada)', () => {
    const boleta2: EmissionInvoice = { ...boleta, correlativo: '2' };
    const xml = buildResumenXml({
      emitter,
      correlativo: '2',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-14',
      lines: [
        { invoice: boleta, estado: '1' },
        { invoice: boleta2, estado: '3' },
      ],
    });
    expect(xml.match(/<sac:SummaryDocumentsLine>/g)).toHaveLength(2);
    expect(xml).toContain('<cbc:ID>B998-2</cbc:ID>');
    expect(xml).toContain('<cbc:ConditionCode>3</cbc:ConditionCode>');
  });

  it('rejects a non-boleta invoice at runtime', () => {
    const factura: EmissionInvoice = { ...boleta, docType: '01', serie: 'F998' };
    expect(() =>
      buildResumenXml({
        emitter,
        correlativo: '1',
        referenceDate: '2026-08-14',
        issueDate: '2026-08-14',
        lines: [{ invoice: factura, estado: '1' }],
      }),
    ).toThrow(/boletas \(03\) only/);
  });
});

describe('buildBajaXml', () => {
  const facturaLine: BajaLine = { docType: '01', serie: 'F998', correlativo: '1', motivo: 'ERROR EN EL COMPROBANTE' };

  it('builds a well-formed RA with id, dates, and one VoidedDocumentsLine per doc', () => {
    const xml = buildBajaXml({
      emitter,
      correlativo: '1',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-15',
      lines: [facturaLine],
    });
    expect(xml).toContain('<cbc:ID>RA-20260815-1</cbc:ID>');
    expect(xml).toContain('<cbc:ReferenceDate>2026-08-14</cbc:ReferenceDate>');
    expect(xml).toContain('<cbc:IssueDate>2026-08-15</cbc:IssueDate>');
    expect(xml).toContain('<sac:DocumentSerialID>F998</sac:DocumentSerialID>');
    expect(xml).toContain('<sac:DocumentNumberID>1</sac:DocumentNumberID>');
    expect(xml).toContain('<sac:VoidReasonDescription>ERROR EN EL COMPROBANTE</sac:VoidReasonDescription>');
    expect(xml).toContain('<cbc:URI>#SignatureSP</cbc:URI>');
  });

  it('escapes free-text VoidReasonDescription (no CDATA)', () => {
    const xml = buildBajaXml({
      emitter,
      correlativo: '1',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-15',
      lines: [{ ...facturaLine, motivo: 'ERROR "A" & <B>' }],
    });
    expect(xml).toContain('<sac:VoidReasonDescription>ERROR &quot;A&quot; &amp; &lt;B&gt;</sac:VoidReasonDescription>');
    expect(xml).not.toContain('CDATA');
  });

  it('rejects a boleta at compile time (docType is the "01" literal, not EmissionDocType)', () => {
    // @ts-expect-error docType '03' is not assignable to BajaLine's '01' literal — the compile-time half of the estado-3 typing rule
    const boletaLine: BajaLine = { docType: '03', serie: 'B998', correlativo: '1', motivo: 'x' };
    void boletaLine;
  });

  it('rejects a boleta at runtime when the type is bypassed (e.g. an untyped JS caller)', () => {
    const boletaLine = { docType: '03', serie: 'B998', correlativo: '1', motivo: 'x' } as unknown as BajaLine;
    expect(() =>
      buildBajaXml({ emitter, correlativo: '1', referenceDate: '2026-08-14', issueDate: '2026-08-15', lines: [boletaLine] }),
    ).toThrow(/facturas \(01\) only/);
  });
});

describe('buildResumenXml carries the boleta\'s own igvRate', () => {
  // The resumen re-derives per-boleta gravada/IGV through computeTotals(), so it
  // inherits the threaded rate — there is deliberately no second divisor here.
  const at = (igvRate: number) =>
    buildResumenXml({
      emitter,
      correlativo: '1',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-14',
      lines: [{ invoice: { ...boleta, igvRate }, estado: '1' }],
    });

  it('a non-statutory rate changes per-boleta gravada and IGV', () => {
    const xml18 = at(0.18);
    const xml10 = at(0.1);
    expect(xml18).toContain('<cbc:PaidAmount currencyID="PEN">100.00</cbc:PaidAmount>');
    expect(xml18).toContain('<cbc:TaxAmount currencyID="PEN">18.00</cbc:TaxAmount>');
    // 118 incl @10% => 107.27 gravada + 10.73 IGV
    expect(xml10).toContain('<cbc:PaidAmount currencyID="PEN">107.27</cbc:PaidAmount>');
    expect(xml10).toContain('<cbc:TaxAmount currencyID="PEN">10.73</cbc:TaxAmount>');
    expect(xml10).not.toContain('<cbc:PaidAmount currencyID="PEN">100.00</cbc:PaidAmount>');
  });

  it('each boleta line stays self-consistent: gravada + IGV === its TotalAmount', () => {
    for (const rate of [0.18, 0.1, 0.08, 0.05]) {
      const xml = at(rate);
      const gravada = Number(/<cbc:PaidAmount currencyID="PEN">([\d.]+)</.exec(xml)?.[1]);
      const igv = Number(/<cbc:TaxAmount currencyID="PEN">([\d.]+)</.exec(xml)?.[1]);
      const total = Number(/<sac:TotalAmount currencyID="PEN">([\d.]+)</.exec(xml)?.[1]);
      expect(Math.round(gravada * 100) + Math.round(igv * 100)).toBe(Math.round(total * 100));
      expect(total).toBe(118); // the inclusive amount is the source, whatever the rate
    }
  });

  it('a mixed-rate resumen keeps each boleta on its own rate', () => {
    const xml = buildResumenXml({
      emitter,
      correlativo: '1',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-14',
      lines: [
        { invoice: { ...boleta, igvRate: 0.18 }, estado: '1' },
        { invoice: { ...boleta, correlativo: '2', igvRate: 0.1 }, estado: '1' },
      ],
    });
    expect(xml).toContain('<cbc:PaidAmount currencyID="PEN">100.00</cbc:PaidAmount>');
    expect(xml).toContain('<cbc:PaidAmount currencyID="PEN">107.27</cbc:PaidAmount>');
  });
});
