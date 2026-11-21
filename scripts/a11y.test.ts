import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { compareRows, ledgerGate, mergeRows, pageRows, parseArgs, storyRows } from './a11y.mjs';

const TAGS = ['wcag2a', 'wcag2aa'];
const violation = (id: string, nodes: number, tags = ['wcag2a']) => ({
  id,
  tags,
  nodes: Array.from({ length: nodes }, (_, i) => ({ target: [`#n${i}`] })),
});
const story = (storyId: string, violations: unknown[], status = 'passed') => ({
  status,
  fullName: storyId,
  failureMessages: status === 'passed' ? [] : ['Error: boom\n  at x'],
  meta: { storyId, reports: [{ type: 'a11y', result: { violations } }] },
});

describe('a11y gate (spec 137)', () => {
  it('selects the backend-free gates by default and validates --only', () => {
    expect(parseArgs([]).gates).toEqual(['suppressions', 'patterns', 'specs', 'stories']);
    expect(parseArgs(['--all']).gates).toContain('pages');
    expect(parseArgs(['--only', 'pages,stories', '--ci']).gates).toEqual(['pages', 'stories']);
    expect(() => parseArgs(['--only', 'nope'])).toThrow(/unknown gate/);
  });

  it('counts story violations per rule for the WCAG tags only; failures are unmeasured', () => {
    const { rows, errors, offenders } = storyRows(
      {
        testResults: [
          {
            name: '/repo/src/A.stories.svelte',
            assertionResults: [
              story('a--one', [
                violation('button-name', 2),
                violation('region', 4, ['best-practice']),
              ]),
              story('a--two', [], 'failed'),
              { status: 'passed', fullName: 'no report', meta: { storyId: 'a--three' } },
            ],
          },
          { name: '/repo/src/B.stories.svelte', message: 'Failed to import', assertionResults: [] },
        ],
      },
      TAGS,
      '/repo',
    );
    expect(rows).toEqual({
      'a--one': { 'button-name': 2 },
      'a--two': 'unmeasured',
      'a--three': 'unmeasured',
      'file:src/B.stories.svelte': 'unmeasured',
    });
    expect(offenders['a--one\u0000button-name']).toEqual(['#n0', '#n1']);
    expect(errors.map((e: { id: string }) => e.id)).toEqual([
      'a--two',
      'a--three',
      'file:src/B.stories.svelte',
    ]);
  });

  it('reads page rows for the ratchet persona and default state only', () => {
    const { rows } = pageRows([
      {
        exactViewport: { id: 'compact-390' },
        pointer: 'coarse',
        results: [
          {
            pattern: '/crm',
            persona: 'owner-admin',
            state: 'populated',
            a11y: { label: { count: 3, offenders: [] } },
          },
          { pattern: '/pos', persona: 'owner-admin', state: 'populated' },
          { pattern: '/x', persona: 'viewer', state: 'populated', a11y: {} },
          { pattern: '/y', persona: 'owner-admin', state: 'empty', a11y: {} },
        ],
      },
    ]);
    expect(rows).toEqual({
      '/crm @ compact-390:coarse': { label: 3 },
      '/pos @ compact-390:coarse': 'unmeasured',
    });
  });

  it('fails when a count rises, a new row has violations or a measured row stops measuring', () => {
    const baseline = { a: { label: 2 }, c: {} };
    const { regressions, improvements, rows } = compareRows('story', baseline, {
      a: { label: 3 },
      b: { 'button-name': 1 },
      c: 'unmeasured',
      d: {},
    });
    expect(regressions.map((r: { id: string; rule: string }) => `${r.id}:${r.rule}`)).toEqual([
      'a:label',
      'b:button-name',
      'c:(unmeasured)',
    ]);
    expect(improvements).toEqual([]);
    expect(rows.find((r: { id: string }) => r.id === 'a')).toMatchObject({ count: 3, baseline: 2 });
    expect(
      ledgerGate({ rows, regressions, improvements }, { ci: true, update: false }).status,
    ).toBe('fail');
  });

  it('passes with --ci when counts fall, and asks for a ratchet locally', () => {
    const compare = compareRows(
      'story',
      { a: { label: 2 }, b: 'unmeasured' },
      { a: { label: 1 }, b: {} },
    );
    expect(compare.regressions).toEqual([]);
    expect(compare.improvements).toHaveLength(2);
    expect(ledgerGate(compare, { ci: true, update: false }).status).toBe('pass');
    expect(ledgerGate(compare, { ci: false, update: false })).toMatchObject({
      status: 'fail',
      hint: expect.any(String),
    });
    expect(ledgerGate(compare, { ci: false, update: true }).status).toBe('pass');
  });

  it('never fails a row outside the gated matrix', () => {
    const compare = compareRows(
      'page',
      {},
      { '/crm @ wide-1440:fine': { label: 5 } },
      {},
      () => false,
    );
    expect(compare.regressions).toEqual([]);
    expect(compare.rows[0].status).toBe('ungated');
  });

  it('merges only measured rows and keeps the ledger sparse', () => {
    expect(
      mergeRows(
        { a: { label: 2 }, b: { list: 1 }, z: { x: 1 } },
        { a: {}, b: { list: 1, 'aria-x': 2 }, c: 'unmeasured' },
      ),
    ).toEqual({
      b: { 'aria-x': 2, list: 1 },
      c: 'unmeasured',
      z: { x: 1 },
    });
  });
});
