import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  normalizeDepositRule,
  readCrmSettingsValue,
  resolveDepositRule,
} from './crm-settings.service';
import { DEFAULT_DEPOSIT_RULE } from './crm-deposit-rule';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

afterEach(() => {
  vi.restoreAllMocks();
});

/** Spy that also silences the warning so a passing run stays readable. */
function warnSpy() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

describe('readCrmSettingsValue', () => {
  it('returns the stored value object', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { accounts: [], deposit: { keywords: ['x'] } } }]);
    expect(await readCrmSettingsValue(ctx(db))).toEqual({
      accounts: [],
      deposit: { keywords: ['x'] },
    });
  });

  it('returns {} when the org has no crm_settings row', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await readCrmSettingsValue(ctx(db))).toEqual({});
  });

  it('propagates a read failure so each caller applies its own fallback', async () => {
    const db = {
      transaction: () => {
        throw new Error('boom');
      },
    } as never;
    await expect(readCrmSettingsValue(ctx(db))).rejects.toThrow('boom');
  });
});

// The normalization contract is the settings boundary's whole job — the SQL
// built downstream binds whatever comes out of here, so each rule below is
// asserted on its own rather than through one happy-path fixture.
describe('normalizeDepositRule', () => {
  it('treats an absent deposit key as "unconfigured": the default rule, no warning', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule(undefined)).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(normalizeDepositRule(null)).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['a bare string', 'reserva'],
    ['an array', ['reserva']],
    ['a number', 7],
  ])('warns and falls back for a deposit value that is %s', (_label, raw) => {
    const warn = warnSpy();
    expect(normalizeDepositRule(raw)).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns and falls back when keywords is not an array', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule({ keywords: 'reserva', label: 'x' })).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns and falls back for a MIXED array rather than silently activating its string members', () => {
    const warn = warnSpy();
    // The dangerous case: salvaging ['adelanto'] here would put an active rule
    // in production that the operator never wrote.
    expect(normalizeDepositRule({ keywords: [' adelanto ', 42] })).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns and falls back when the label is not a string', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule({ keywords: ['adelanto'], label: 3 })).toEqual(
      DEFAULT_DEPOSIT_RULE,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('trims and lowercases keywords — surrounding whitespace never reaches the ILIKE pattern', () => {
    // ' Adelanto ' compiled verbatim would be '% adelanto %' and would fail to
    // match an ordinary "Adelanto de cita" line.
    expect(normalizeDepositRule({ keywords: [' Adelanto ', 'SEÑA'] })).toEqual({
      keywords: ['adelanto', 'seña'],
      label: DEFAULT_DEPOSIT_RULE.label,
    });
  });

  it('dedupes stably — first occurrence wins, case/whitespace variants collapse', () => {
    expect(
      normalizeDepositRule({ keywords: ['adelanto', 'seña', 'ADELANTO', ' adelanto'] }).keywords,
    ).toEqual(['adelanto', 'seña']);
  });

  it('drops blank entries without treating them as malformed', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule({ keywords: ['adelanto', '   ', ''] }).keywords).toEqual([
      'adelanto',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('truncates every keyword to 40 characters so one entry cannot become an unbounded SQL parameter', () => {
    const long = 'a'.repeat(200);
    const { keywords } = normalizeDepositRule({ keywords: [long] });
    expect(keywords).toEqual(['a'.repeat(40)]);
  });

  it('truncates the label to 40 characters too', () => {
    const { label } = normalizeDepositRule({ keywords: [], label: 'b'.repeat(200) });
    expect(label).toBe('b'.repeat(40));
  });

  it('caps the keyword list at 20 entries and warns about the ones it drops', () => {
    const warn = warnSpy();
    const many = Array.from({ length: 50 }, (_v, i) => `kw${i}`);
    const { keywords } = normalizeDepositRule({ keywords: many });
    expect(keywords).toHaveLength(20);
    expect(keywords[0]).toBe('kw0');
    expect(keywords.at(-1)).toBe('kw19');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('honors an explicitly empty keyword array — not absent, not malformed', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule({ keywords: [], label: 'None' })).toEqual({
      keywords: [],
      label: 'None',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores sibling keys it does not own — including the updatedAt the write path stamps', () => {
    // `crm_settings.value.deposit` is written by a strict schema that owns
    // `updatedAt`; the read side must not choke on it, nor on a key added by a
    // later slice, nor let either leak into the rule the SQL binds.
    const warn = warnSpy();
    expect(
      normalizeDepositRule({ keywords: ['adelanto'], updatedAt: '2026-08-20T00:00:00Z', next: 1 }),
    ).toEqual({ keywords: ['adelanto'], label: DEFAULT_DEPOSIT_RULE.label });
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the default label when the stored label is missing or blank', () => {
    expect(normalizeDepositRule({ keywords: ['adelanto'] }).label).toBe(DEFAULT_DEPOSIT_RULE.label);
    expect(normalizeDepositRule({ keywords: ['adelanto'], label: '  ' }).label).toBe(
      DEFAULT_DEPOSIT_RULE.label,
    );
  });
});

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

  it('returns the normalized stored rule', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: { keywords: [' Adelanto ', 'seña'], label: 'Adelanto' } } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual({
      keywords: ['adelanto', 'seña'],
      label: 'Adelanto',
    });
  });

  it('warns and falls back to DEFAULT_DEPOSIT_RULE when the read throws', async () => {
    const warn = warnSpy();
    const db = {
      transaction: () => {
        throw new Error('boom');
      },
    } as never;
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
