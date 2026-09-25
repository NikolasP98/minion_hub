import { describe, expect, it } from 'vitest';
import { groupByVoidMethod, parseArgs, type ProdEmissionRow } from './sunat-baja-hub-emissions';

function row(overrides: Partial<ProdEmissionRow>): ProdEmissionRow {
  return {
    org_id: 'org-1',
    doc_type: '03',
    serie: 'B999',
    correlativo: 1,
    total: '50.00',
    created_at: new Date('2026-09-18T00:00:00Z'),
    client_doc_type: null,
    client_doc_number: null,
    ...overrides,
  };
}

describe('groupByVoidMethod', () => {
  it('routes facturas (01) to baja and everything else to resumen estado-3', () => {
    const rows = [row({ doc_type: '01', serie: 'F001' }), row({ doc_type: '03', serie: 'B999' })];
    const { baja, resumenEstado3 } = groupByVoidMethod(rows);
    expect(baja.map((r) => r.serie)).toEqual(['F001']);
    expect(resumenEstado3.map((r) => r.serie)).toEqual(['B999']);
  });

  it('never puts a factura in the resumen bucket or a boleta in the baja bucket', () => {
    const rows = [row({ doc_type: '01' }), row({ doc_type: '03' })];
    const { baja, resumenEstado3 } = groupByVoidMethod(rows);
    expect(baja.every((r) => r.doc_type === '01')).toBe(true);
    expect(resumenEstado3.every((r) => r.doc_type !== '01')).toBe(true);
  });
});

describe('parseArgs', () => {
  it('defaults to dry-run, every org', () => {
    expect(parseArgs([])).toEqual({ apply: false, org: null });
  });

  it('parses --apply and --org', () => {
    expect(parseArgs(['--apply', '--org', 'abc'])).toEqual({ apply: true, org: 'abc' });
  });
});
