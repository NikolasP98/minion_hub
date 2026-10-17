import { describe, expect, it } from 'vitest';
import { AUDIT_VIEWPORTS } from '../tests/e2e/ui-audit/viewports';
import {
  DEFAULT_MATRIX,
  assembleRunEnv,
  compareArgs,
  expandMatrix,
  parseSweepArgs,
  requireLoopbackSupabase,
  runId,
  playwrightArgs,
  RATCHET_STATES,
  CI_MATRIX_ENTRY,
} from './ui-audit-sweep';

describe('parseSweepArgs', () => {
  it('defaults to the bounded compare-only sweep', () => {
    expect(parseSweepArgs([])).toEqual({
      full: false,
      routes: [],
      updateLedger: false,
      ci: false,
      dryRun: false,
    });
  });

  it('reads every flag and splits --routes', () => {
    expect(
      parseSweepArgs([
        '--full',
        '--routes',
        '/stock/items, /agents',
        '--update-ledger',
        '--ci',
        '--dry-run',
      ]),
    ).toEqual({
      full: true,
      routes: ['/stock/items', '/agents'],
      updateLedger: true,
      ci: true,
      dryRun: true,
    });
  });
});

describe('expandMatrix', () => {
  it('default = owner-admin × {compact-390 coarse, wide-1440 fine}', () => {
    expect(expandMatrix({ full: false, ci: false })).toEqual([
      { personas: 'owner-admin', viewport: 'compact-390', pointer: 'coarse' },
      { personas: 'owner-admin', viewport: 'wide-1440', pointer: 'fine' },
    ]);
    expect(DEFAULT_MATRIX).toHaveLength(2);
  });

  it('--full = all personas × every registered viewport × both pointers', () => {
    const full = expandMatrix({ full: true, ci: false });
    expect(full).toHaveLength(Object.keys(AUDIT_VIEWPORTS).length * 2);
    expect(full.every((entry) => entry.personas === 'all')).toBe(true);
    expect(new Set(full.map(runId)).size).toBe(full.length);
  });

  it('--ci ignores --full and runs the single CI entry', () => {
    expect(expandMatrix({ full: true, ci: true })).toEqual([CI_MATRIX_ENTRY]);
  });
});

describe('assembleRunEnv', () => {
  const entry = { personas: 'owner-admin', viewport: 'compact-390', pointer: 'coarse' } as const;

  it('sets the conformance flags, matrix selection, deterministic run id and base URL; fixtures win over the base', () => {
    const env = assembleRunEnv(
      { PATH: '/usr/bin', E2E_UI_AUDIT_FIXTURES: 'stale', E2E_UI_AUDIT_ROUTES: '/leaked' },
      entry,
      {
        baseUrl: 'http://127.0.0.1:5187',
        routes: [],
        fixtures: { E2E_UI_AUDIT_FIXTURES: '[]', E2E_OWNER_EMAIL: 'o@minion.test' },
      },
    );
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      E2E_UI_AUDIT: '1',
      E2E_UI_AUDIT_CONFORMANCE: '1',
      E2E_UI_AUDIT_ALLOW_BLOCKED: '1',
      E2E_UI_AUDIT_VIEWPORT: 'compact-390',
      E2E_UI_AUDIT_POINTER: 'coarse',
      E2E_UI_AUDIT_PERSONAS: 'owner-admin',
      E2E_UI_AUDIT_ROUTES: '',
      E2E_UI_AUDIT_RUN_ID: 'sweep--compact-390--coarse',
      E2E_BASE_URL: 'http://127.0.0.1:5187',
      E2E_UI_AUDIT_FIXTURES: '[]',
      E2E_OWNER_EMAIL: 'o@minion.test',
    });
  });

  it('passes --routes through as a comma list', () => {
    expect(
      assembleRunEnv({}, entry, {
        baseUrl: 'http://127.0.0.1:5199',
        routes: ['/a', '/b'],
        fixtures: {},
      }).E2E_UI_AUDIT_ROUTES,
    ).toBe('/a,/b');
  });
});

describe('requireLoopbackSupabase', () => {
  it('accepts loopback and refuses hosted or missing targets (the seed never reaches a real project)', () => {
    expect(requireLoopbackSupabase({ PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54421' })).toBe(
      '127.0.0.1',
    );
    expect(() => requireLoopbackSupabase({ PUBLIC_SUPABASE_URL: 'https://x.supabase.co' })).toThrow(
      /NOT loopback/,
    );
    expect(() => requireLoopbackSupabase({})).toThrow(/missing/);
  });
});

describe('compareArgs', () => {
  it('always compares and summarises; --ci and --update-ledger pass through', () => {
    const base = { full: false, routes: [], updateLedger: false, ci: false, dryRun: false };
    expect(compareArgs(base, ['a.json'])).toEqual([
      'scripts/ui-audit-conformance.mjs',
      '--compare',
      '--summary',
      'a.json',
    ]);
    expect(compareArgs({ ...base, ci: true, updateLedger: true }, ['a.json', 'b.json'])).toEqual([
      'scripts/ui-audit-conformance.mjs',
      '--compare',
      '--summary',
      '--ci',
      '--update-ledger',
      'a.json',
      'b.json',
    ]);
  });
});

describe('ratchet matrix guards', () => {
  const entry = { viewport: 'compact-390', pointer: 'coarse', personas: 'owner-admin' } as const;
  const context = { baseUrl: 'http://127.0.0.1:5187', routes: [], fixtures: {} };

  it('limits the ratchet run to the default populated states and leaves --full unfiltered', () => {
    expect(
      assembleRunEnv({}, entry, { ...context, states: RATCHET_STATES }).E2E_UI_AUDIT_STATES,
    ).toBe('populated,default');
    expect(assembleRunEnv({}, entry, context).E2E_UI_AUDIT_STATES).toBeUndefined();
  });

  it('gives every Playwright run its own output directory so earlier artifacts survive', () => {
    const args = playwrightArgs(entry);
    expect(args.slice(0, 2)).toEqual(['playwright', 'test']);
    expect(args.at(-2)).toBe('--output');
    expect(args.at(-1)).toContain('playwright-sweep--compact-390--coarse');
  });
});

describe('CI matrix', () => {
  it('runs one viewport in CI (T012: a full pass is ~7 min, budget 10) and both locally', () => {
    expect(expandMatrix({ full: false, ci: true })).toEqual([CI_MATRIX_ENTRY]);
    expect(CI_MATRIX_ENTRY).toMatchObject({ viewport: 'compact-390', pointer: 'coarse' });
    expect(expandMatrix({ full: false, ci: false })).toHaveLength(2);
  });
});
