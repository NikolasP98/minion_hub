import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { resolveDepositRule } from './crm-deposit-settings.service';
import { DEFAULT_DEPOSIT_RULE } from './crm-deposit-rule';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('resolveDepositRule', () => {
  it('falls back to DEFAULT_DEPOSIT_RULE when no crm_settings row exists', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
  });

  it('falls back to DEFAULT_DEPOSIT_RULE when the deposit key is absent', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { accounts: [] } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
  });

  it('falls back to DEFAULT_DEPOSIT_RULE for a malformed deposit value (not an object)', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: 'reserva' } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
  });

  it('falls back to DEFAULT_DEPOSIT_RULE when keywords is not an array', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: { keywords: 'reserva', label: 'x' } } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
  });

  it('returns a custom rule, dropping non-string/blank entries but keeping valid keywords', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { value: { deposit: { keywords: ['adelanto', '  ', 42, 'seña'], label: 'Adelanto' } } },
    ]);
    expect(await resolveDepositRule(ctx(db))).toEqual({
      keywords: ['adelanto', 'seña'],
      label: 'Adelanto',
    });
  });

  it('honors an explicitly empty keyword array — not treated as absent/malformed', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: { keywords: [], label: 'None' } } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual({ keywords: [], label: 'None' });
  });

  it('falls back to DEFAULT_DEPOSIT_RULE.label when the stored label is missing/blank', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: { keywords: ['adelanto'] } } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual({
      keywords: ['adelanto'],
      label: DEFAULT_DEPOSIT_RULE.label,
    });
  });

  it('falls back to DEFAULT_DEPOSIT_RULE when the read throws', async () => {
    const db = {
      transaction: () => {
        throw new Error('boom');
      },
    } as never;
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
  });
});
