import { describe, it, expect, vi, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  normalizeDepositRule,
  normalizeIcpDefinition,
  readCrmSettingsValue,
  resolveDepositRule,
  resolveIcpDefinition,
  saveIcpDefinition,
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

// ── ICP definition (`crm_settings.value.icp`) ───────────────────────────────

const STORED_ICP = {
  description: 'Clinics in Lima with budget for a full treatment plan.',
  criteria: [{ id: 'budget', label: 'Has budget for a full plan', weight: 5 }],
  disqualifiers: ['only ever asks for free consults'],
  version: 3,
  updatedAt: '2026-08-29T00:00:00.000Z',
};

describe('normalizeIcpDefinition', () => {
  it('treats an absent icp key as "feature off": null, no warning', () => {
    const warn = warnSpy();
    expect(normalizeIcpDefinition(undefined)).toBeNull();
    expect(normalizeIcpDefinition(null)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns a well-formed stored definition as-is', () => {
    expect(normalizeIcpDefinition(STORED_ICP)).toEqual(STORED_ICP);
  });

  it.each([
    ['a bare string', 'our ideal customer'],
    ['an array', [STORED_ICP]],
    ['a definition missing its server-owned version', { ...STORED_ICP, version: undefined }],
    [
      'a definition with an out-of-range weight',
      {
        ...STORED_ICP,
        criteria: [{ id: 'budget', label: 'x', weight: 9 }],
      },
    ],
    [
      'a definition with 9 criteria',
      {
        ...STORED_ICP,
        criteria: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, label: 'x', weight: 1 })),
      },
    ],
  ])('warns and returns null (never a salvaged subset) for %s', (_label, raw) => {
    const warn = warnSpy();
    expect(normalizeIcpDefinition(raw)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('resolveIcpDefinition', () => {
  it('reads the org definition out of the shared settings row', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: { keywords: ['reserva'] }, icp: STORED_ICP } }]);
    expect(await resolveIcpDefinition(ctx(db))).toEqual(STORED_ICP);
  });

  it('returns null when the org has no settings row at all', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await resolveIcpDefinition(ctx(db))).toBeNull();
  });

  it('never throws on a settings read failure — the feature goes quiet, the caller keeps working', async () => {
    const warn = warnSpy();
    const db = {
      transaction: () => {
        throw new Error('boom');
      },
    } as never;
    expect(await resolveIcpDefinition(ctx(db))).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

/**
 * A tx that RECORDS the upsert instead of executing it, so the shipped
 * statement's shape is assertable directly (the behaviour it buys is proven
 * against a real engine in `crm-icp-settings.atomic-write.test.ts`).
 */
function makeRecordingTx(returned: unknown[]) {
  const calls: { values?: Record<string, unknown>; set?: Record<string, unknown> } = {};
  const chain: Record<string, unknown> = {
    values: (v: Record<string, unknown>) => {
      calls.values = v;
      return chain;
    },
    onConflictDoUpdate: (c: { set: Record<string, unknown> }) => {
      calls.set = c.set;
      return chain;
    },
    returning: () => Promise.resolve(returned),
  };
  let selectCalls = 0;
  const tx = {
    execute: async () => [],
    insert: () => chain,
    select: () => {
      selectCalls++;
      return chain;
    },
  };
  return {
    db: { transaction: (fn: (tx: unknown) => unknown) => fn(tx) },
    calls,
    selectCount: () => selectCalls,
  };
}

const ICP_INPUT = {
  description: STORED_ICP.description,
  criteria: STORED_ICP.criteria,
  disqualifiers: STORED_ICP.disqualifiers,
};

describe('saveIcpDefinition — the write boundary', () => {
  it('rejects an invalid definition before any statement is built', async () => {
    const { db, calls } = makeRecordingTx([]);
    await expect(
      saveIcpDefinition(ctx(db as never), {
        ...ICP_INPUT,
        disqualifiers: ['a', 'b', 'c', 'd', 'e', 'f'],
      }),
    ).rejects.toThrow();
    expect(calls.values).toBeUndefined();
  });

  it('refuses a client-supplied `version` rather than trusting it', async () => {
    const { db } = makeRecordingTx([]);
    await expect(
      saveIcpDefinition(ctx(db as never), { ...ICP_INPUT, version: 99 } as never),
    ).rejects.toThrow();
  });

  it('derives the next version IN the update expression and never selects it first', async () => {
    const { db, calls, selectCount } = makeRecordingTx([
      { value: { icp: { ...ICP_INPUT, version: 4, updatedAt: 'now' } } },
    ]);
    const saved = await saveIcpDefinition(ctx(db as never), ICP_INPUT);
    expect(saved.version).toBe(4);
    expect(selectCount()).toBe(0); // no read-modify-write

    const query = new PgDialect().sqlToQuery(calls.set!.value as SQL);
    // One jsonb_set targeting ONLY the `icp` path — the sibling keys
    // (deposit/accounts/winAnalysis) on this row are never rewritten.
    expect(query.sql).toContain('jsonb_set');
    expect(query.sql).toContain("'{icp}'");
    // The version comes from the row being updated, not from a bound parameter.
    expect(query.sql).toContain('jsonb_typeof');
    expect(query.sql.toLowerCase()).not.toMatch(/\bselect\b/);
    const body = query.params.find((p) => typeof p === 'string' && p.includes('description'));
    expect(String(body)).not.toContain('"version"');
  });

  it('stamps updatedAt server-side into the written body', async () => {
    const { db, calls } = makeRecordingTx([
      { value: { icp: { ...ICP_INPUT, version: 1, updatedAt: 'now' } } },
    ]);
    await saveIcpDefinition(ctx(db as never), ICP_INPUT);
    const query = new PgDialect().sqlToQuery(calls.set!.value as SQL);
    const body = String(
      query.params.find((p) => typeof p === 'string' && p.includes('description')),
    );
    expect(JSON.parse(body).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('fails loudly when the written row does not read back as a valid definition', async () => {
    const warn = warnSpy();
    const { db } = makeRecordingTx([{ value: { icp: { description: 'x' } } }]);
    await expect(saveIcpDefinition(ctx(db as never), ICP_INPUT)).rejects.toThrow('round-trip');
    expect(warn).toHaveBeenCalled();
  });
});
