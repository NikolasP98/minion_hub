import { describe, it, expect } from 'vitest';
import {
  blockedPackageConsumption,
  candidatesFor,
  compositionSummary,
  writePathFor,
} from './composition';

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
    const c = candidatesFor({ productId: 'self', kind: 'service' }, sellables, items, {
      stockEnabled: true,
      formatMoney: money,
    });
    expect(c.map((x) => x.id)).toEqual(['p:svc', 'i:it-self', 'i:it-1']);
    expect(c[0]).toMatchObject({ kind: 'service', detail: 'S/ 10', ref: 'svc' });
  });

  it('a product may contain stock items only — every item, through its recipe', () => {
    const c = candidatesFor({ productId: 'prd', kind: 'product' }, sellables, items, {
      stockEnabled: true,
      formatMoney: money,
    });
    expect(c.map((x) => x.id)).toEqual(['i:it-self', 'i:it-1']);
  });

  it('stock module off → services only', () => {
    const c = candidatesFor({ productId: 'self', kind: 'service' }, sellables, items, {
      stockEnabled: false,
      formatMoney: money,
    });
    expect(c.map((x) => x.id)).toEqual(['p:svc']);
  });
});

describe('writePathFor — one table per child kind', () => {
  it('service child → package edges; stock-item child → the recipe, whatever the parent', () => {
    expect(writePathFor('service')).toBe('package');
    expect(writePathFor('product')).toBe('consumption');
  });
});

describe('blockedPackageConsumption — a pack never re-declares an included service’s insumo', () => {
  it('blocks an item the included service already consumes', () => {
    // FACES: SKU-AF1 (pack) adding the 6 ml of Acido Desoxicolico that SKU-AF2
    // (its included session service) already consumes.
    expect(blockedPackageConsumption([{ itemId: 'acido' }], ['acido'])).toEqual(['acido']);
  });

  it('lets through an insumo no included service consumes — that is what the pack hands over', () => {
    expect(blockedPackageConsumption([{ itemId: 'gauze' }], ['acido'])).toEqual([]);
  });

  it('a non-package parent blocks nothing', () => {
    expect(blockedPackageConsumption([{ itemId: 'acido' }], [])).toEqual([]);
  });

  it('reports each offending item once', () => {
    expect(
      blockedPackageConsumption([{ itemId: 'acido' }, { itemId: 'acido' }], ['acido', 'acido']),
    ).toEqual(['acido']);
  });
});

describe('compositionSummary', () => {
  const l = {
    pkg: 'Paquete',
    sessions: (n: number) => `${n} ses.`,
    products: (n: number) => `${n} prod.`,
    insumos: (n: number) => `${n} insumos`,
  };

  it('a package reads as sessions + handed-over products', () => {
    expect(
      compositionSummary({ kind: 'bundle', packageSessions: 4, consumedItemNames: ['Gasa'] }, l),
    ).toBe('Paquete · 4 ses. + 1 prod.');
  });

  it('a package with only sessions drops the products half', () => {
    expect(
      compositionSummary({ kind: 'bundle', packageSessions: 4, consumedItemNames: [] }, l),
    ).toBe('Paquete · 4 ses.');
  });

  it('one insumo shows its name — the name IS the information', () => {
    expect(
      compositionSummary(
        {
          kind: 'service',
          packageSessions: 0,
          consumedItemNames: ['Acido Desoxicolico'],
        },
        l,
      ),
    ).toBe('Acido Desoxicolico');
  });

  it('several insumos are counted', () => {
    expect(
      compositionSummary(
        { kind: 'service', packageSessions: 0, consumedItemNames: ['a', 'b', 'c'] },
        l,
      ),
    ).toBe('3 insumos');
  });

  it('nothing composed says —', () => {
    expect(
      compositionSummary({ kind: 'service', packageSessions: 0, consumedItemNames: [] }, l),
    ).toBe('—');
  });
});
