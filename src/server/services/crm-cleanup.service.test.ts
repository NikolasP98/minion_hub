import { describe, it, expect, vi } from 'vitest';

// The scans only use tx.execute — return the fixture rows for every query.
let fixtureRows: unknown[] = [];
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) =>
    fn({ execute: async () => fixtureRows }),
}));

import { findBlanks, findDuplicates } from './crm-cleanup.service';
import type { CoreCtx } from '$server/auth/core-ctx';

const ctx = { tenantId: 'org-1' } as unknown as CoreCtx;

const blankRow = {
  id: 'c1',
  display_name: '.',
  dni: '12345678',
  phone: '997703234',
  messages: 3,
  identities: [
    { channel: 'whatsapp', value: '997703234', externalId: '51997703234', handle: '997703234' },
  ],
};

const dupRows = [
  {
    id: 'c1',
    display_name: 'Ana Perez',
    dni: '12345678',
    phone: '997703234',
    custom_fields: { dni: '12345678', distrito: 'Lima' },
    messages: 3,
    identities: [
      { channel: 'whatsapp', value: '997703234', externalId: '51997703234', handle: '997703234' },
    ],
  },
  {
    id: 'c2',
    display_name: 'Ana P.',
    dni: '12345678',
    phone: '997703235',
    custom_fields: {},
    messages: 1,
    identities: [],
  },
];

describe('cleanup scans: field-level PII masking', () => {
  it('findBlanks returns raw PII for an unmasked caller', async () => {
    fixtureRows = [blankRow];
    const [b] = await findBlanks(ctx);
    expect(b.dni).toBe('12345678');
    expect(b.phone).toBe('997703234');
    expect(b.identities[0].handle).toBe('997703234');
  });

  it('findBlanks redacts dni, phone, and every identity field when masked', async () => {
    fixtureRows = [blankRow];
    const [b] = await findBlanks(ctx, { maskSensitive: true });
    expect(b.dni).not.toContain('1234567');
    expect(b.phone).not.toContain('99770');
    for (const i of b.identities) {
      expect(i.value).not.toContain('99770');
      expect(i.externalId).not.toContain('99770');
      expect(i.handle).not.toContain('99770');
    }
    // Redaction keeps a recognizable tail, not the full value.
    expect(b.dni).toMatch(/•/);
  });

  it('findDuplicates redacts contacts, custom_fields PII keys, and the DNI group key when masked', async () => {
    fixtureRows = dupRows;
    const groups = await findDuplicates(ctx, { maskSensitive: true });
    const dniGroup = groups.find((g) => g.reason === 'dni');
    expect(dniGroup).toBeDefined();
    expect(dniGroup!.key).not.toBe('12345678');
    for (const c of dniGroup!.contacts) {
      expect(c.dni).not.toBe('12345678');
      expect(String(c.customFields['dni'] ?? '')).not.toBe('12345678');
      for (const i of c.identities) {
        expect(i.value).not.toContain('99770');
        expect(i.handle ?? '').not.toContain('99770');
      }
    }
    // Non-PII custom fields survive untouched.
    expect(dniGroup!.contacts[0].customFields['distrito']).toBe('Lima');
  });

  it('findDuplicates leaves everything raw for an unmasked caller', async () => {
    fixtureRows = dupRows;
    const groups = await findDuplicates(ctx);
    const dniGroup = groups.find((g) => g.reason === 'dni');
    expect(dniGroup!.key).toBe('12345678');
    expect(dniGroup!.contacts[0].dni).toBe('12345678');
  });
});
