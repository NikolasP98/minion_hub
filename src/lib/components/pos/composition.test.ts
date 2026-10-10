import { describe, it, expect } from 'vitest';
import { candidatesFor, writePathFor } from './composition';

const money = (n: number) => `S/ ${n}`;
const sellables = [
  {
    productId: 'self',
    code: 'SELF',
    name: 'Self',
    unitPrice: 1,
    kind: 'service' as const,
    active: true,
  },
  {
    productId: 'svc',
    code: 'SVC',
    name: 'Service',
    unitPrice: 10,
    kind: 'service' as const,
    active: true,
  },
  {
    productId: 'off',
    code: 'OFF',
    name: 'Retired',
    unitPrice: 10,
    kind: 'service' as const,
    active: false,
  },
  {
    productId: 'pkg',
    code: 'PKG',
    name: 'Package',
    unitPrice: 50,
    kind: 'bundle' as const,
    active: true,
  },
  {
    productId: 'prd',
    code: 'PRD',
    name: 'Product',
    unitPrice: 5,
    kind: 'product' as const,
    active: true,
  },
];
const items = [
  { id: 'it-self', code: 'ITS', name: 'Own item', uom: 'unit' },
  { id: 'it-1', code: 'IT1', name: 'Vial', uom: 'ml' },
];

describe('candidatesFor — invariant I2', () => {
  it('a service may contain active services (never itself, a retired one, or a package) and stock items', () => {
    const c = candidatesFor(
      { productId: 'self', kind: 'service', itemId: null },
      sellables,
      items,
      { stockEnabled: true, formatMoney: money },
    );
    expect(c.map((x) => x.id)).toEqual(['p:svc', 'i:it-self', 'i:it-1']);
    expect(c[0]).toMatchObject({ kind: 'service', detail: 'S/ 10', ref: 'svc' });
  });

  it('a product may contain stock items only, never its own item', () => {
    const c = candidatesFor(
      { productId: 'prd', kind: 'product', itemId: 'it-self' },
      sellables,
      items,
      { stockEnabled: true, formatMoney: money },
    );
    expect(c.map((x) => x.id)).toEqual(['i:it-1']);
  });

  it('a product without a stock item has nothing to compose through', () => {
    const c = candidatesFor({ productId: 'prd', kind: 'product', itemId: null }, sellables, items, {
      stockEnabled: true,
      formatMoney: money,
    });
    expect(c).toEqual([]);
  });

  it('stock module off → services only', () => {
    const c = candidatesFor(
      { productId: 'self', kind: 'service', itemId: null },
      sellables,
      items,
      { stockEnabled: false, formatMoney: money },
    );
    expect(c.map((x) => x.id)).toEqual(['p:svc']);
  });
});

describe('writePathFor — one table per (parent, child) pair', () => {
  it('service child → package edges, whatever the parent', () => {
    expect(writePathFor('service', 'service')).toBe('package');
  });
  it('product child under a service → consumption; under a product → stock BOM', () => {
    expect(writePathFor('service', 'product')).toBe('consumption');
    expect(writePathFor('product', 'product')).toBe('bom');
  });
});
