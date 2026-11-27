#!/usr/bin/env node
/**
 * a11y — the one accessibility gate command (spec 137). Same command locally and in CI.
 *
 *   bun run a11y                          # suppressions, patterns, specs, stories (no backend needed)
 *   bun run a11y --all                    # + pages (runs the page sweep; needs the QA stack, `bun run qa:up`)
 *   bun run a11y --only stories,pages     # pick gates: suppressions, patterns, specs, stories, pages
 *   bun run a11y --only stories --stories Dropdown   # story-file filter (vitest name filter)
 *   bun run a11y --only pages --routes /crm,/pos/sell
 *   bun run a11y --only pages --artifacts <dir>      # judge run-sweep--*.json from a CI artifact, no sweep
 *   bun run a11y --update-baseline        # ratchet baselines DOWN; refuses when anything regressed
 *   bun run a11y --ci                     # improvements do not fail (CI cannot commit a ratchet)
 *
 * stdout is ONE JSON document; progress and child output go to stderr. stdout lists only the
 * rows that changed (`--verbose` for all); test-results/a11y/report.json always has every row. Exit 1 when a gate fails. Baselines only decrease:
 *   - tests/ui-audit/a11y-ledger.json     page × viewport × rule and story × rule violation counts
 *   - scripts/.design-lint-baseline.json  `a11y-ignore` (svelte-ignore a11y_* rule tokens)
 * A row missing from the ledger is a baseline of zero: new pages and stories start clean.
 * `unstable` in the ledger (id → reason) holds a row that flips between runs at its highest count.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RATCHET_PERSONA,
  RATCHET_STATES,
  readArtifacts,
  scenarioKey,
} from './ui-audit-conformance.mjs';

export const GATES = ['suppressions', 'patterns', 'specs', 'stories', 'pages'];
const DEFAULT_GATES = GATES.filter((gate) => gate !== 'pages');
const ROOT = path.join(fileURLToPath(import.meta.url), '..', '..');
const OUT = path.join(ROOT, 'test-results', 'a11y');
const LEDGER = path.join(ROOT, 'tests', 'ui-audit', 'a11y-ledger.json');
const TAGS_FILE = path.join(ROOT, 'tests', 'ui-audit', 'a11y-tags.json');
const UNMEASURED = 'unmeasured';
const WORKSHOP_PORT = 18907;
const ARIA_PORT = 18908;
/** The story run takes about 6 minutes in CI; the job's own limit is 25. */
const STORY_RUN_LIMIT_MS = Number(process.env.A11Y_STORY_RUN_LIMIT_MS) || 11 * 60_000;

/** Pure. */
export function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const list = (flag) =>
    (value(flag) ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  const only = list('--only');
  const unknown = only.filter((gate) => !GATES.includes(gate));
  if (unknown.length)
    throw new Error(`unknown gate(s): ${unknown.join(', ')} (${GATES.join(', ')})`);
  return {
    gates: only.length ? only : argv.includes('--all') ? [...GATES] : DEFAULT_GATES,
    ci: argv.includes('--ci'),
    update: argv.includes('--update-baseline'),
    routes: list('--routes'),
    stories: value('--stories'),
    artifacts: value('--artifacts'),
    verbose: argv.includes('--verbose'),
  };
}

const sum = (row) =>
  row && row !== UNMEASURED ? Object.values(row).reduce((total, count) => total + count, 0) : 0;

/**
 * Pure: vitest JSON (storybook project) → story id → rule counts | 'unmeasured'.
 * A failed story, a story file that failed to import and a story without an a11y
 * report are all unmeasured: visible, never skipped.
 */
export function storyRows(vitestJson, tags, root = ROOT) {
  const rows = {};
  const offenders = {};
  const errors = [];
  for (const file of vitestJson.testResults ?? []) {
    const relative = path.relative(root, file.name);
    if (!file.assertionResults?.length) {
      rows[`file:${relative}`] = UNMEASURED;
      errors.push({ id: `file:${relative}`, message: firstLine(file.message) || 'no story ran' });
      continue;
    }
    for (const test of file.assertionResults) {
      const id = test.meta?.storyId ?? `${relative}::${test.fullName}`;
      const report = (test.meta?.reports ?? []).find((entry) => entry.type === 'a11y');
      if (test.status !== 'passed' || !report?.result?.violations) {
        rows[id] = UNMEASURED;
        errors.push({
          id,
          message: firstLine(test.failureMessages?.[0]) || 'no accessibility report for this story',
        });
        continue;
      }
      rows[id] = {};
      for (const violation of report.result.violations) {
        if (!violation.tags.some((tag) => tags.includes(tag))) continue;
        rows[id][violation.id] = violation.nodes.length;
        offenders[`${id}\u0000${violation.id}`] = violation.nodes
          .slice(0, 5)
          .map((node) => node.target.join(' '));
      }
    }
  }
  return { rows, offenders, errors };
}

/** Pure: sweep run artifacts → `page @ scenario` → rule counts | 'unmeasured'. */
export function pageRows(artifacts) {
  const rows = {};
  const offenders = {};
  for (const artifact of artifacts) {
    const scenario = scenarioKey(artifact);
    for (const result of artifact.results) {
      if (result.persona !== RATCHET_PERSONA || !RATCHET_STATES.includes(result.state)) continue;
      const id = `${result.pattern} @ ${scenario}`;
      if (!result.a11y) {
        rows[id] = UNMEASURED;
        continue;
      }
      rows[id] = {};
      for (const [rule, evidence] of Object.entries(result.a11y)) {
        rows[id][rule] = evidence.count;
        offenders[`${id}\u0000${rule}`] = evidence.offenders;
      }
    }
  }
  return { rows, offenders };
}

/**
 * Pure: compare this run's rows with the committed ones. `unstable` (ledger: id → reason)
 * names rows whose count flips between runs of the same code; they never count as improved. Only ids this run measured are
 * judged, so a partial run (one story file, a route subset) never reports the rest.
 * `gated(id)` false = a row outside the committed matrix (reported, never failing).
 */
export function compareRows(
  kind,
  baseline,
  current,
  offenders = {},
  gated = () => true,
  unstable = {},
) {
  const rows = [];
  const regressions = [];
  const improvements = [];
  for (const id of Object.keys(current).sort()) {
    const now = current[id];
    const before = baseline[id] ?? {};
    const push = (rule, count, base, status) => {
      const row = { kind, id, rule, count, baseline: base, status: gated(id) ? status : 'ungated' };
      const sample = offenders[`${id}\u0000${rule}`];
      if (sample?.length) row.offenders = sample;
      rows.push(row);
      if (row.status === 'regression') regressions.push(row);
      if (row.status === 'improvement') improvements.push(row);
    };
    if (now === UNMEASURED) {
      push(
        '(unmeasured)',
        1,
        before === UNMEASURED ? 1 : 0,
        before === UNMEASURED ? 'same' : 'regression',
      );
      continue;
    }
    if (before === UNMEASURED) {
      push('(unmeasured)', 0, 1, 'improvement');
      for (const [rule, count] of Object.entries(now)) push(rule, count, count, 'same');
      continue;
    }
    for (const rule of [...new Set([...Object.keys(now), ...Object.keys(before)])].sort()) {
      const count = now[rule] ?? 0;
      const base = before[rule] ?? 0;
      if (count === 0 && base === 0) continue;
      // An `unstable` row flips between runs of the same code; it is held at its highest count.
      const fell = count < base && !(id in unstable);
      push(rule, count, base, count > base ? 'regression' : fell ? 'improvement' : 'same');
    }
  }
  return { rows, regressions, improvements };
}

/** Pure: measured rows replace their baseline rows; clean rows leave the (sparse) ledger. */
export function mergeRows(baseline, current, unstable = {}) {
  const next = { ...baseline };
  for (const [id, row] of Object.entries(current)) {
    if (id in unstable && id in baseline) continue;
    if (row !== UNMEASURED && sum(row) === 0) delete next[id];
    else next[id] = row === UNMEASURED ? row : sortKeys(row);
  }
  return sortKeys(next);
}

function sortKeys(value) {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
}

const firstLine = (text) =>
  String(text ?? '')
    .split('\n')[0]
    .slice(0, 300);

/** Pure: gate verdict from a compare. Improvements fail locally until the ledger is ratcheted. */
export function ledgerGate(compare, options, extra = {}) {
  const stale = compare.improvements.length > 0 && !options.ci && !options.update;
  return {
    status: compare.regressions.length ? 'fail' : stale ? 'fail' : 'pass',
    ...(stale && !compare.regressions.length
      ? { hint: 'counts fell: run `bun run a11y --update-baseline` and commit the ledger' }
      : {}),
    violations: compare.rows.reduce(
      (t, row) => t + (row.rule === '(unmeasured)' ? 0 : row.count),
      0,
    ),
    baseline: compare.rows.reduce(
      (t, row) => t + (row.rule === '(unmeasured)' ? 0 : row.baseline),
      0,
    ),
    regressions: compare.regressions.length,
    improvements: compare.improvements.length,
    ...extra,
  };
}

const log = (message) => console.error(`a11y: ${message}`);

/** Run a child; its output goes to OUR stderr so stdout stays one JSON document. */
function run(command, args, env = {}, scan, limitMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group when it has a limit, so the kill also takes its browser.
      detached: Boolean(limitMs),
    });
    let matched = false;
    let timedOut = false;
    // A child that outlives its limit is killed: a hung runner must not eat the whole CI job.
    const limit =
      limitMs &&
      setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }, limitMs);
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        if (scan?.test(String(chunk))) matched = true;
        process.stderr.write(chunk);
      });
    child.on('error', () => (clearTimeout(limit), resolve({ code: 127, matched, timedOut })));
    child.on(
      'exit',
      (code) => (clearTimeout(limit), resolve({ code: code ?? 1, matched, timedOut })),
    );
  });
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const vitest = ['node_modules/vitest/vitest.mjs', 'run'];
const playwright = ['node_modules/@playwright/test/cli.js', 'test'];

async function suppressions(options) {
  const out = path.join(OUT, 'design-lint.json');
  if (options.update) await run('node', ['scripts/design-lint.mjs', '--update-baseline']);
  await run('node', ['scripts/design-lint.mjs', '--ci', `--json=${out}`]);
  if (!existsSync(out)) return { status: 'error', message: 'design-lint wrote no result' };
  const result = readJson(out);
  const count = result.totals['a11y-ignore'];
  const baseline = result.baseline?.['a11y-ignore'] ?? null;
  const files = result.fileRegressions.filter((entry) => entry.rule === 'a11y-ignore');
  if (!result.baseRefAvailable)
    return {
      status: 'error',
      message: 'git base ref unavailable (fetch origin/master)',
      count,
      baseline,
    };
  return {
    status: baseline === null || count > baseline || files.length ? 'fail' : 'pass',
    count,
    baseline,
    regressions: files,
  };
}

async function patterns() {
  const out = path.join(OUT, 'patterns.json');
  const files = await new Promise((resolve) => {
    let text = '';
    const child = spawn('git', ['grep', '--untracked', '-l', 'assert-pattern', '--', '*.test.ts'], {
      cwd: ROOT,
    });
    child.stdout.on('data', (chunk) => (text += chunk));
    child.on('exit', () => resolve(text.split('\n').filter(Boolean)));
  });
  if (!files.length) return { status: 'pass', files: 0, tests: 0, failures: [] };
  await run('node', [...vitest, ...files, '--reporter=json', `--outputFile=${out}`]);
  if (!existsSync(out)) return { status: 'error', message: 'vitest wrote no result' };
  const result = readJson(out);
  const failures = result.testResults.flatMap((file) =>
    file.assertionResults.length === 0 && file.status !== 'passed'
      ? [{ file: path.relative(ROOT, file.name), test: '(file)', message: file.message }]
      : file.assertionResults
          .filter((test) => test.status === 'failed')
          .map((test) => ({
            file: path.relative(ROOT, file.name),
            test: test.fullName,
            message: test.failureMessages?.[0] ?? '',
          })),
  );
  return {
    status: failures.length ? 'fail' : 'pass',
    files: files.length,
    tests: result.numTotalTests,
    failures,
  };
}

function playwrightFailures(report) {
  const failures = [];
  const walk = (suite, trail) => {
    for (const spec of suite.specs ?? [])
      if (!spec.ok) {
        const error = spec.tests?.flatMap((test) => test.results ?? []).find((r) => r.error)?.error;
        const title = [...trail, spec.title].filter(Boolean).join(' › ');
        failures.push(error ? `${title}: ${firstLine(error.message)}` : title);
      }
    for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  };
  for (const suite of report.suites ?? []) walk(suite, [suite.title]);
  return failures;
}

/**
 * One fixture-backed spec suite: build `tests/fixtures/<name>` to a fresh directory, serve it
 * from an owned loopback port, run `playwright.<key>.config.ts` (Chromium) against it.
 */
async function fixtureSuite(name, key, port, record, suites) {
  const KEY = key.toUpperCase();
  const fixture = path.join(mkdtempSync(path.join(tmpdir(), `minion-a11y-${key}-`)), 'out');
  const built = await run('node', [`tests/fixtures/${name}/build.mjs`], {
    [`MINION_${KEY}_FIXTURE_OUT`]: fixture,
  });
  if (built.code !== 0)
    return suites.push({ name, status: 'error', failures: ['fixture build failed'] });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname;
    const file = path.join(fixture, path.normalize(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(fixture) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(readFileSync(file));
  });
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(port, '127.0.0.1', resolve),
  );
  const report = path.join(OUT, `${key}.json`);
  try {
    // TODO(handoff): Chromium only; the configs' Firefox and WebKit projects are not in CI yet
    // (meta proposals/2026-11-20-hub-accessibility-program.md, S0 open ends).
    await run(
      'node',
      [...playwright, '--config', `playwright.${key}.config.ts`, '--project', 'chromium'],
      {
        [`MINION_${KEY}_URL`]: `http://127.0.0.1:${port}`,
        [`MINION_${KEY}_RESULTS`]: path.join('test-results', `a11y-${key}`),
        [`MINION_${KEY}_REPORT`]: report,
      },
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
  record(name, report);
}

/**
 * The three credential-free accessibility specs (FR-008; spec 155): chart canvas, workshop and
 * the aria snapshots of five complex widgets.
 */
async function specs() {
  const suites = [];
  const record = (name, file) => {
    if (!existsSync(file))
      return suites.push({ name, status: 'error', failures: ['no report written'] });
    const report = readJson(file);
    const failures = playwrightFailures(report);
    suites.push({
      name,
      status: failures.length || !report.stats?.expected ? 'fail' : 'pass',
      passed: report.stats?.expected ?? 0,
      failures,
    });
  };

  const canvas = path.join(OUT, 'canvas.json');
  // E2E_BASE_URL only stops the default config from starting a dev server; the spec serves its own fixture.
  await run(
    'node',
    [
      ...playwright,
      'tests/e2e/ui-audit/canvas-accessibility.spec.ts',
      '--reporter=json',
      '--output',
      path.join('test-results', 'a11y-canvas'),
    ],
    { E2E_BASE_URL: 'http://127.0.0.1:9', PLAYWRIGHT_JSON_OUTPUT_NAME: canvas },
  );
  record('canvas-accessibility', canvas);

  // TODO(handoff): Chromium only; the workshop config's Firefox and WebKit projects are not in
  // CI yet (meta proposals/2026-11-20-hub-accessibility-program.md, S0 open ends).
  await fixtureSuite('workshop-accessibility', 'workshop', WORKSHOP_PORT, record, suites);
  // What a screen reader is given for five complex widgets, pinned as files (spec 155).
  await fixtureSuite('aria-snapshots', 'aria', ARIA_PORT, record, suites);
  return { status: suites.every((suite) => suite.status === 'pass') ? 'pass' : 'fail', suites };
}

async function stories(options, ledger, tags) {
  const out = path.join(OUT, 'stories-vitest.json');
  // Vitest's own exit code is ignored: a failing story is an `unmeasured` row judged against the ledger.
  const once = () =>
    run(
      'node',
      [
        ...vitest,
        '--project',
        'storybook',
        ...(options.stories ? [options.stories] : []),
        '--reporter=json',
        // Also the plain reporter: it names each story file as it finishes, so a hang shows where.
        '--reporter=default',
        `--outputFile.json=${out}`,
      ],
      { STORYBOOK_TESTS: '1' },
      /optimized dependencies changed/,
      STORY_RUN_LIMIT_MS,
    );
  // On a cold dependency cache Vite re-bundles mid-run and reloads the page: story files fail
  // to import and others are measured half-styled. That run is void; the cache is warm now.
  // `--artifacts <dir>` judges an existing stories-vitest.json instead of running the stories.
  const reuse =
    options.artifacts && path.join(path.resolve(options.artifacts), 'stories-vitest.json');
  if (reuse) return judge(reuse, false);
  let first = await once();
  // Seen twice in CI (master ec24b96b, PR #756): the browser runner goes silent and never ends.
  // A healthy run takes about 6 minutes; a killed one has measured nothing, so it runs again.
  if (first.timedOut) {
    log('stories: the story runner hung and was killed after its time limit; running once more');
    rmSync(out, { force: true });
    first = await once();
    if (first.timedOut)
      return { gate: { status: 'error', message: 'the story runner hung twice (time limit)' } };
  }
  const coldCacheRerun = first.matched;
  if (coldCacheRerun) {
    log('stories: the dependency cache was cold (Vite reloaded mid-run); running once more');
    await once();
  }
  return judge(out, coldCacheRerun);

  function judge(out, coldCacheRerun) {
    if (!existsSync(out)) return { gate: { status: 'error', message: 'vitest wrote no result' } };
    const current = storyRows(readJson(out), tags);
    const compare = compareRows(
      'story',
      ledger.stories ?? {},
      current.rows,
      current.offenders,
      // No committed story section yet = first baseline: report, do not fail.
      () => ledger.stories !== undefined,
      ledger.unstable,
    );
    return {
      current: current.rows,
      compare,
      gate: ledgerGate(compare, options, {
        measured: Object.keys(current.rows).length,
        unmeasured: current.errors,
        coldCacheRerun,
      }),
    };
  }
}

async function pages(options, ledger) {
  const started = Date.now();
  // `--artifacts <dir>` judges run artifacts someone else produced (a CI download): no sweep, no stack.
  const sweepExit = options.artifacts
    ? 0
    : (
        await run('bun', [
          'scripts/ui-audit-sweep.ts',
          ...(options.ci ? ['--ci'] : []),
          ...(options.routes.length ? ['--routes', options.routes.join(',')] : []),
        ])
      ).code;
  const dir = options.artifacts
    ? path.resolve(options.artifacts)
    : path.join(ROOT, 'test-results', 'ui-audit');
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => /^run-sweep--.*\.json$/.test(name))
        .map((name) => path.join(dir, name))
        .filter((file) => options.artifacts || statSync(file).mtimeMs >= started)
    : [];
  if (!files.length)
    return {
      gate: {
        status: 'error',
        sweepExit,
        message: 'the page sweep wrote no run artifact (is the QA stack up? `bun run qa:up`)',
      },
    };
  const artifacts = readArtifacts(files);
  const current = pageRows(artifacts);
  // Only viewports the ledger already gates can fail; `--update-baseline` adopts new ones.
  const gatedScenarios = new Set(ledger.pageScenarios ?? []);
  const compare = compareRows(
    'page',
    ledger.pages ?? {},
    current.rows,
    current.offenders,
    (id) => gatedScenarios.has(id.split(' @ ')[1]),
    ledger.unstable,
  );
  const gate = ledgerGate(compare, options, {
    measured: Object.keys(current.rows).length,
    scenarios: artifacts.map(scenarioKey),
    sweepExit,
  });
  // The sweep also judges the spec 014 conformance rules; its failure fails this gate too.
  if (sweepExit !== 0) gate.status = 'fail';
  return { current: current.rows, compare, gate, scenarios: artifacts.map(scenarioKey) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(OUT, { recursive: true });
  const ledger = existsSync(LEDGER) ? readJson(LEDGER) : { schemaVersion: 1 };
  const tags = readJson(TAGS_FILE);
  const gates = Object.fromEntries(GATES.map((gate) => [gate, { status: 'skipped' }]));
  const rows = [];
  const next = structuredClone(ledger);

  for (const gate of options.gates) {
    log(`gate ${gate} …`);
    if (gate === 'suppressions') gates.suppressions = await suppressions(options);
    else if (gate === 'patterns') gates.patterns = await patterns();
    else if (gate === 'specs') gates.specs = await specs();
    else {
      const result =
        gate === 'stories' ? await stories(options, ledger, tags) : await pages(options, ledger);
      gates[gate] = result.gate;
      if (!result.compare) continue;
      rows.push(...result.compare.rows);
      if (options.update && result.compare.regressions.length === 0) {
        next[gate] = mergeRows(ledger[gate] ?? {}, result.current, ledger.unstable);
        if (gate === 'pages')
          next.pageScenarios = [
            ...new Set([...(ledger.pageScenarios ?? []), ...result.scenarios]),
          ].sort();
      }
    }
    log(`gate ${gate} — ${gates[gate].status}`);
  }

  if (options.update && JSON.stringify(next) !== JSON.stringify(ledger)) {
    writeFileSync(LEDGER, `${JSON.stringify({ ...next, tags }, null, 2)}\n`);
    // CI's prettier check covers changed JSON, so the ledger is written in prettier's form.
    await run('node', ['node_modules/prettier/bin/prettier.cjs', '--write', LEDGER]);
    log(`ledger ratcheted → ${path.relative(ROOT, LEDGER)}`);
  }
  const ok = Object.values(gates).every((gate) => ['pass', 'skipped'].includes(gate.status));
  const report = {
    schemaVersion: 1,
    command: `bun run a11y ${process.argv.slice(2).join(' ')}`.trim(),
    ok,
    tags,
    gates,
    rows,
  };
  const file = path.join(OUT, 'report.json');
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  // stdout stays small enough to read: unchanged rows live in the report file only.
  const changed = options.verbose ? rows : rows.filter((row) => row.status !== 'same');
  const summary = {
    ...report,
    rows: changed,
    rowsOmitted: rows.length - changed.length,
    report: path.relative(ROOT, file),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`a11y: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
