import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildLedger,
  compareLedgers,
  compareScope,
  ledgerPaths,
  main,
  readArtifacts,
  renderSummaryHtml,
  renderSummaryMarkdown,
  runScope,
} from './ui-audit-conformance.mjs';

const PASS = {
  overflow: { verdict: 'pass', px: 0, elements: ['should-not-enter-ledger'] },
  targets: { verdict: 'pass', undersized: 0, dense: ['data-table', 'chart', 'data-table'] },
  'dominant-action': { verdict: 'pass', primary: 1 },
  archetype: { verdict: 'pass' },
  health: { verdict: 'pass', messages: [] },
  title: { verdict: 'pass', count: 1 },
};

function result(pattern, conformance = PASS, extra = {}) {
  return {
    scenarioKey: `ns:${pattern}:owner-admin:compact:default`,
    routeId: pattern,
    pattern,
    persona: 'owner-admin',
    viewportClass: 'compact',
    state: 'default',
    outcome: 'captured',
    screenshot: `/abs/test-results/ui-audit/run--${pattern.replace(/\W+/g, '-')}.png`,
    conformance,
    ...extra,
  };
}

function artifact(
  results,
  { viewport = 'compact-390', pointer = 'coarse', routeFilter = [] } = {},
) {
  return {
    schemaVersion: 4,
    runId: `run-${viewport}-${pointer}`,
    startedAt: '2026-10-16T00:00:00.000Z',
    appCommit: 'abc1234',
    fixtureVersion: 'ui-audit-v1',
    namespace: 'ns',
    exactViewport: { id: viewport, width: 390, height: 844, class: 'compact' },
    theme: 'account-default',
    project: 'chromium',
    pointer,
    certificationEnabled: false,
    routeFilter,
    results,
    summary: { planned: results.length, captured: results.length, blocked: 0, failed: 0 },
  };
}

const withRule = (rule, value) => ({ ...PASS, [rule]: value });

test('buildLedger keeps only verdict + numbers, sorts keys and dense regions, drops other personas/states', () => {
  const run = artifact([
    result('/stock/items'),
    result('/agents'),
    result('/agents', PASS, { persona: 'member-viewer' }),
    result('/agents', PASS, { state: 'empty' }),
  ]);
  const ledger = buildLedger([run]);
  assert.deepEqual(Object.keys(ledger), ['matrix', 'pages', 'schemaVersion']);
  assert.deepEqual(Object.keys(ledger.pages), ['/agents', '/stock/items']);
  assert.deepEqual(ledger.matrix, {
    personas: ['owner-admin'],
    state: 'default',
    viewports: ['compact-390:coarse'],
  });
  const row = ledger.pages['/stock/items']['compact-390:coarse'];
  assert.deepEqual(Object.keys(row), [
    'archetype',
    'dominant-action',
    'health',
    'overflow',
    'targets',
    'title',
  ]);
  assert.deepEqual(row.overflow, { px: 0, verdict: 'pass' });
  assert.deepEqual(row.targets.dense, ['chart', 'data-table']);
  assert.equal(JSON.stringify(ledger).includes('screenshot'), false);
});

test('buildLedger is deterministic regardless of result order and marks missing evidence blocked', () => {
  const a = artifact([
    result('/a'),
    result('/b', null, { outcome: 'blocked-fixture', blockReason: 'Fixture x absent' }),
  ]);
  const b = artifact([a.results[1], a.results[0]]);
  assert.equal(JSON.stringify(buildLedger([a])), JSON.stringify(buildLedger([b])));
  const blocked = buildLedger([a]).pages['/b']['compact-390:coarse'];
  for (const rule of Object.values(blocked))
    assert.deepEqual(rule, { reason: 'Fixture x absent', verdict: 'blocked' });
});

test('runScope/compareScope: a full run compares every committed page; a --routes subset only itself', () => {
  const committed = buildLedger([artifact([result('/a'), result('/b')])]);
  const full = artifact([result('/a')]);
  assert.deepEqual(runScope([full]), { 'compact-390:coarse': ['/a'] });
  assert.deepEqual(compareScope(committed, [full]), { 'compact-390:coarse': ['/a', '/b'] });
  const subset = artifact([result('/a')], { routeFilter: ['/a'] });
  assert.deepEqual(compareScope(committed, [subset]), { 'compact-390:coarse': ['/a'] });
});

function compare(committedResults, currentResults, allowlist = [], opts) {
  const committed = buildLedger([artifact(committedResults, opts)]);
  const current = artifact(currentResults, opts);
  return compareLedgers(
    committed,
    buildLedger([current]),
    allowlist,
    compareScope(committed, [current]),
  );
}

test('compare: pass → fail and allow-listed → fail regress; numbers in the message', () => {
  const r1 = compare(
    [result('/a')],
    [result('/a', withRule('overflow', { verdict: 'fail', px: 42 }))],
  );
  assert.match(
    r1.regressions[0],
    /\/a @ compact-390:coarse · overflow: pass → fail \(pass px=0 → fail px=42\)/,
  );
  const r2 = compare(
    [result('/a', withRule('archetype', { verdict: 'allow-listed', reason: 'owns composition' }))],
    [result('/a', withRule('archetype', { verdict: 'fail' }))],
  );
  assert.match(r2.regressions[0], /archetype: allow-listed → fail/);
  assert.equal(r2.improvements.length, 0);
});

test('compare: a fail that worsens in numbers regresses; one that shrinks improves', () => {
  const worse = compare(
    [result('/a', withRule('targets', { verdict: 'fail', undersized: 2 }))],
    [result('/a', withRule('targets', { verdict: 'fail', undersized: 5 }))],
  );
  assert.match(worse.regressions[0], /targets: fail worsened/);
  const better = compare(
    [result('/a', withRule('targets', { verdict: 'fail', undersized: 5 }))],
    [result('/a', withRule('targets', { verdict: 'fail', undersized: 2 }))],
  );
  assert.equal(better.regressions.length, 0);
  assert.match(better.improvements[0], /fail undersized=5 → fail undersized=2/);
});

test('compare: blocked where the ledger holds a verdict is a prerequisite regression; blocked → blocked is quiet', () => {
  const r = compare(
    [result('/a')],
    [result('/a', null, { outcome: 'blocked-fixture', blockReason: 'fixture gone' })],
  );
  assert.equal(r.regressions.length, 6);
  assert.match(r.regressions[0], /pass → blocked \(fixture gone\)/);
  const quiet = compare(
    [result('/a', null, { outcome: 'blocked-fixture', blockReason: 'x' })],
    [result('/a', null, { outcome: 'blocked-fixture', blockReason: 'x' })],
  );
  assert.deepEqual(quiet, { regressions: [], improvements: [] });
});

test('compare: a planned page without a ledger row fails; a ledger row the run never reached fails', () => {
  const missing = compare([result('/a')], [result('/a'), result('/new')]);
  assert.match(missing.regressions[0], /\/new @ compact-390:coarse: no ledger row/);
  const unreached = compare([result('/a'), result('/b')], [result('/a')]);
  assert.match(
    unreached.regressions[0],
    /\/b @ compact-390:coarse: not reached by this run \(blocked, prerequisite regression\)/,
  );
  const subset = compare([result('/a'), result('/b')], [result('/a')], [], { routeFilter: ['/a'] });
  assert.deepEqual(subset, { regressions: [], improvements: [] });
});

test('compare: an allow-listed row whose measurement passes demands removing the entry; declarations without an entry do not', () => {
  const allowlisted = withRule('overflow', { verdict: 'allow-listed', px: 0, reason: 'canvas' });
  const entry = [
    {
      page: '/a',
      rule: 'overflow',
      class: 'owns-composition',
      reason: 'canvas',
      reverifiedAt: '2026-10-16',
    },
  ];
  const flagged = compare([result('/a', allowlisted)], [result('/a', allowlisted)], entry);
  assert.match(
    flagged.regressions[0],
    /overflow: measurement now passes — remove the allow-list entry/,
  );
  const declaration = compare([result('/a', allowlisted)], [result('/a', allowlisted)]);
  assert.deepEqual(declaration, { regressions: [], improvements: [] });
  const stillFailing = compare(
    [result('/a', withRule('overflow', { verdict: 'allow-listed', px: 120 }))],
    [result('/a', withRule('overflow', { verdict: 'allow-listed', px: 120 }))],
    entry,
  );
  assert.deepEqual(stillFailing, { regressions: [], improvements: [] });
  const measured = compare(
    [result('/a', withRule('archetype', { verdict: 'allow-listed', measured: 'fail' }))],
    [result('/a', withRule('archetype', { verdict: 'allow-listed', measured: 'pass' }))],
    [
      {
        page: '/a',
        rule: 'archetype',
        class: 'adoption-debt',
        reason: 'x',
        reverifiedAt: '2026-10-16',
      },
    ],
  );
  assert.match(measured.regressions[0], /archetype: measurement now passes/);
});

test('compare: fail → pass is an improvement, identical ledgers are silent', () => {
  const improved = compare(
    [result('/a', withRule('overflow', { verdict: 'fail', px: 9 }))],
    [result('/a')],
  );
  assert.deepEqual(improved.regressions, []);
  assert.match(improved.improvements[0], /overflow: fail px=9 → pass px=0/);
  assert.deepEqual(compare([result('/a')], [result('/a')]), { regressions: [], improvements: [] });
});

function tempRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ui-audit-conformance-'));
  mkdirSync(path.join(root, 'test-results', 'ui-audit'), { recursive: true });
  return root;
}

function writeRun(root, data, name = 'run-a.json') {
  const file = path.join(root, 'test-results', 'ui-audit', name);
  writeFileSync(file, JSON.stringify(data));
  return file;
}

function quiet(fn) {
  const logs = [];
  const { log, error, warn } = console;
  console.log = console.error = console.warn = (...args) => logs.push(args.join(' '));
  try {
    return { code: fn(), logs };
  } finally {
    Object.assign(console, { log, error, warn });
  }
}

test('main: no ledger → "blocked: no ledger yet" exit 0; --update-ledger creates it; then compare is unchanged', () => {
  const root = tempRoot();
  const run = writeRun(root, artifact([result('/a')]));
  const blocked = quiet(() => main(['--compare', run], root));
  assert.equal(blocked.code, 0, blocked.logs.join('\n'));
  assert.match(blocked.logs.join('\n'), /blocked: no ledger yet/);
  assert.equal(quiet(() => main(['--update-ledger', run], root)).code, 0);
  const ledger = JSON.parse(readFileSync(ledgerPaths(root).ledger, 'utf8'));
  assert.deepEqual(Object.keys(ledger.pages), ['/a']);
  const again = quiet(() => main(['--compare', run], root));
  assert.equal(again.code, 0);
  assert.match(again.logs.join('\n'), /ledger unchanged/);
});

test('main: improvements exit 1 locally, 0 with --ci; regressions exit 1 and --update-ledger refuses to rewrite', () => {
  const root = tempRoot();
  const failing = writeRun(
    root,
    artifact([result('/a', withRule('overflow', { verdict: 'fail', px: 9 }))]),
    'failing.json',
  );
  quiet(() => main(['--update-ledger', failing], root));
  const before = readFileSync(ledgerPaths(root).ledger, 'utf8');
  const passing = writeRun(root, artifact([result('/a')]), 'passing.json');
  const local = quiet(() => main(['--compare', passing], root));
  assert.equal(local.code, 1);
  assert.match(local.logs.join('\n'), /ledger can be ratcheted/);
  assert.equal(quiet(() => main(['--compare', '--ci', passing], root)).code, 0);
  const worse = writeRun(
    root,
    artifact([result('/a', withRule('overflow', { verdict: 'fail', px: 90 }))]),
    'worse.json',
  );
  const refused = quiet(() => main(['--update-ledger', worse], root));
  assert.equal(refused.code, 1);
  assert.match(refused.logs.join('\n'), /REGRESSION .*fail worsened/);
  assert.equal(readFileSync(ledgerPaths(root).ledger, 'utf8'), before);
  assert.equal(quiet(() => main(['--compare', '--ci', worse], root)).code, 1);
});

test('main: --summary writes md + html with failing/allow-listed/blocked rows, reasons and screenshot links; copies failing shots', () => {
  const root = tempRoot();
  const shot = path.join(root, 'test-results', 'ui-audit', 'run--a.png');
  writeFileSync(shot, 'png');
  mkdirSync(path.dirname(ledgerPaths(root).allowlist), { recursive: true });
  writeFileSync(
    ledgerPaths(root).allowlist,
    JSON.stringify([
      {
        page: '/b',
        rule: 'archetype',
        class: 'owns-composition',
        reason: 'PluginControlCenter composes its own header',
        reverifiedAt: '2026-10-16',
      },
    ]),
  );
  const run = writeRun(
    root,
    artifact([
      result('/a', withRule('overflow', { verdict: 'fail', px: 42 }), { screenshot: shot }),
      result('/b', withRule('archetype', { verdict: 'allow-listed' })),
      result('/c', null, {
        outcome: 'blocked-fixture',
        blockReason: 'Fixture plugin-detail absent',
      }),
      result('/d', withRule('title', { verdict: 'n/a', reason: 'non-title archetype' })),
    ]),
  );
  assert.equal(quiet(() => main(['--summary', run], root)).code, 0);
  const md = readFileSync(path.join(root, 'test-results', 'ui-audit', 'summary.md'), 'utf8');
  assert.match(md, /\| overflow \| 2 \| 1 \| 0 \| 1 \| 0 \|/);
  assert.match(md, /\| title \| 2 \| 0 \| 0 \| 1 \| 1 \|/);
  assert.match(
    md,
    /\| \/a \| compact-390:coarse \| overflow \| fail px=42 \| \[screenshot\]\(run--a\.png\) \|/,
  );
  assert.match(
    md,
    /\| \/b \| compact-390:coarse \| archetype \| owns-composition \| PluginControlCenter composes its own header \| 2026-10-16 \|/,
  );
  assert.match(md, /\| \/c \| compact-390:coarse \| overflow \| Fixture plugin-detail absent \|/);
  const html = readFileSync(path.join(root, 'test-results', 'ui-audit', 'summary.html'), 'utf8');
  assert.match(html, /<h2>Failing \(1\)<\/h2>/);
  assert.match(html, /<a href="run--a\.png">screenshot<\/a>/);
  assert.ok(existsSync(path.join(root, 'test-results', 'ui-audit', 'failing', 'run--a.png')));
});

test('main: --compare --summary includes the compare section; usage and bad artifacts are rejected', () => {
  const root = tempRoot();
  const run = writeRun(
    root,
    artifact([result('/a', withRule('overflow', { verdict: 'fail', px: 9 }))]),
  );
  quiet(() => main(['--update-ledger', run], root));
  const passing = writeRun(root, artifact([result('/a')]), 'p.json');
  assert.equal(quiet(() => main(['--compare', '--summary', '--ci', passing], root)).code, 0);
  const md = readFileSync(path.join(root, 'test-results', 'ui-audit', 'summary.md'), 'utf8');
  assert.match(md, /Regressions: 0 · improvements: 1/);
  assert.match(md, /- improved \/a @ compact-390:coarse · overflow/);
  assert.equal(quiet(() => main([], root)).code, 2);
  assert.equal(quiet(() => main(['--compare'], root)).code, 2);
  const junk = writeRun(root, { routes: [] }, 'route-inventory.json');
  assert.throws(() => readArtifacts([junk]), /not a route-audit run artifact/);
});

test('renderSummaryHtml turns the markdown shapes into headings, tables and list items', () => {
  const md = renderSummaryMarkdown({
    ledger: buildLedger([artifact([result('/a')])]),
    artifacts: [artifact([result('/a')])],
    allowlist: [],
    compare: null,
    summaryDir: '/abs/test-results/ui-audit',
  });
  const html = renderSummaryHtml(md);
  assert.match(html, /<h1>Page conformance summary<\/h1>/);
  assert.match(html, /<tr><th>rule<\/th><th>pass<\/th>/);
  assert.match(html, /<li><code>compact-390:coarse<\/code> — app abc1234/);
  assert.match(html, /<p>None\.<\/p>/);
});
