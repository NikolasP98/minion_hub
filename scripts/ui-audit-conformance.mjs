#!/usr/bin/env node
/**
 * ui-audit-conformance — per-page conformance ledger ratchet (spec 014).
 *
 * Reads schema-v4 route-audit run artifacts (`test-results/ui-audit/run-*.json`,
 * each result carrying `conformance` per contracts/conformance.md), builds the
 * deterministic ledger (`tests/ui-audit/conformance-ledger.json`: sorted keys,
 * page → `viewportId:pointer` → rule → verdict + numbers, no paths or times)
 * and compares it with the committed one. Mirrors scripts/design-lint.mjs:
 * debt only decreases; a human never has to sweep by hand again.
 *
 *   node scripts/ui-audit-conformance.mjs --compare run.json [run2.json…]
 *   node scripts/ui-audit-conformance.mjs --compare --ci run.json…      # improvements do not fail
 *   node scripts/ui-audit-conformance.mjs --update-ledger run.json…     # refuses on regression
 *   node scripts/ui-audit-conformance.mjs --summary run.json…           # summary.md + summary.html
 *
 * Exit 1 on: pass|allow-listed → fail, numbers worsening inside a fail, a
 * planned page without a ledger row, a ledger row the run did not reach
 * (blocked = prerequisite regression), an allow-listed row whose measurement
 * now passes ("remove the allow-list entry"). Improvements print "ledger can
 * be ratcheted": exit 0 with --ci, exit 1 locally unless --update-ledger.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = ['archetype', 'dominant-action', 'health', 'overflow', 'targets', 'title'];
export const RATCHET_PERSONA = 'owner-admin';
/** The default populated state of each archetype (manifest state templates name it either way). */
export const RATCHET_STATES = ['populated', 'default'];
/** Verdict + the measurement; element lists, messages and screenshots stay in the artifact. */
const LEDGER_FIELDS = ['verdict', 'reason', 'px', 'undersized', 'dense', 'primary', 'count'];
const WORSENING_FIELDS = ['px', 'undersized', 'primary'];

export function ledgerPaths(root) {
  return {
    ledger: path.join(root, 'tests', 'ui-audit', 'conformance-ledger.json'),
    allowlist: path.join(root, 'tests', 'ui-audit', 'conformance-allowlist.json'),
    summaryDir: path.join(root, 'test-results', 'ui-audit'),
  };
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

export function scenarioKey(artifact) {
  return `${artifact.exactViewport.id}:${artifact.pointer}`;
}

function ledgerRule(rule, evidence, result) {
  const source = evidence?.[rule];
  if (!source || typeof source.verdict !== 'string') {
    return {
      verdict: 'blocked',
      reason: result.blockReason ?? `no conformance evidence (outcome ${result.outcome})`,
    };
  }
  const row = {};
  for (const field of LEDGER_FIELDS) {
    if (source[field] === undefined) continue;
    // Blocked reasons can carry Playwright call logs; only the first line is stable enough to ledger.
    row[field] =
      field === 'dense'
        ? [...new Set(source.dense)].sort()
        : field === 'reason'
          ? String(source[field]).split('\n')[0]
          : source[field];
  }
  return row;
}

/** Pure: artifacts → ledger. Only the ratchet persona's default state enters it. */
export function buildLedger(artifacts) {
  const pages = {};
  const viewports = new Set();
  for (const artifact of artifacts) {
    const scenario = scenarioKey(artifact);
    viewports.add(scenario);
    for (const result of artifact.results) {
      if (result.persona !== RATCHET_PERSONA || !RATCHET_STATES.includes(result.state)) continue;
      const row = {};
      for (const rule of RULES) row[rule] = ledgerRule(rule, result.conformance, result);
      pages[result.pattern] ??= {};
      pages[result.pattern][scenario] = row;
    }
  }
  return sortKeys({
    schemaVersion: 1,
    matrix: {
      personas: [RATCHET_PERSONA],
      viewports: [...viewports].sort(),
      states: RATCHET_STATES,
    },
    pages,
  });
}

function isEqual(left, right) {
  return JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));
}

/**
 * Pure. `committed` is the ledger on disk (or null), `current` the one built
 * from this run's artifacts, `scope` names which (scenario → pages) this run
 * planned so a `--routes` subset never reports the rest as missing.
 */
export function compareLedgers(committed, current, allowlist, scope) {
  const regressions = [];
  const allowListed = new Map();
  const improvements = [];
  const allowed = new Set(allowlist.map((entry) => `${entry.page}\u0000${entry.rule}`));

  for (const [scenario, plannedPages] of Object.entries(scope)) {
    for (const page of plannedPages) {
      const currentRow = current.pages[page]?.[scenario];
      const committedRow = committed?.pages?.[page]?.[scenario];
      if (!currentRow) {
        if (committedRow)
          regressions.push(
            `${page} @ ${scenario}: not reached by this run (blocked, prerequisite regression)`,
          );
        continue;
      }
      if (!committedRow) {
        regressions.push(
          `${page} @ ${scenario}: no ledger row (add it with --update-ledger after reviewing the verdicts)`,
        );
        continue;
      }
      for (const rule of RULES) {
        const prev = committedRow[rule] ?? { verdict: 'blocked', reason: 'no row' };
        const cur = currentRow[rule];
        const label = `${page} @ ${scenario} · ${rule}`;
        if (allowed.has(`${page}\u0000${rule}`)) {
          const seen = allowListed.get(`${page}\u0000${rule}`) ?? { scenarios: 0, passing: 0 };
          seen.scenarios += 1;
          if (cur.verdict === 'pass') seen.passing += 1;
          allowListed.set(`${page}\u0000${rule}`, seen);
        }
        // A blocked page that stays blocked is quiet; its reason text is not a measurement.
        if (prev.verdict === 'blocked' && cur.verdict === 'blocked') continue;
        if (isEqual(prev, cur)) continue;
        // Anything that was not already failing (pass, allow-listed, n/a, blocked) becoming a fail is new debt.
        const settled = prev.verdict !== 'fail';
        if (settled && cur.verdict === 'fail') {
          regressions.push(
            `${label}: ${prev.verdict} → fail (${describe(prev)} → ${describe(cur)})`,
          );
        } else if (prev.verdict !== 'blocked' && cur.verdict === 'blocked') {
          regressions.push(
            `${label}: ${prev.verdict} → blocked (${cur.reason ?? 'prerequisite regression'})`,
          );
        } else if (
          prev.verdict === 'fail' &&
          cur.verdict === 'fail' &&
          WORSENING_FIELDS.some(
            (f) => typeof prev[f] === 'number' && typeof cur[f] === 'number' && cur[f] > prev[f],
          )
        ) {
          regressions.push(`${label}: fail worsened (${describe(prev)} → ${describe(cur)})`);
        } else {
          improvements.push(`${label}: ${describe(prev)} → ${describe(cur)}`);
        }
      }
    }
  }
  // The allow-list is not viewport-keyed: an entry is stale only when the rule passes in every
  // scenario this run measured for the page.
  for (const [key, seen] of allowListed) {
    if (seen.scenarios > 0 && seen.passing === seen.scenarios) {
      const [page, rule] = key.split('\u0000');
      regressions.push(
        `${page} · ${rule}: passes in every measured scenario — remove the allow-list entry`,
      );
    }
  }
  return { regressions, improvements };
}

/** Pure: a partial run (route subset, one viewport) updates only the rows it measured. */
export function mergeLedger(committed, current) {
  const pages = structuredClone(committed.pages ?? {});
  for (const [page, scenarios] of Object.entries(current.pages)) {
    pages[page] = { ...(pages[page] ?? {}), ...scenarios };
  }
  const viewports = [
    ...new Set([...(committed.matrix?.viewports ?? []), ...current.matrix.viewports]),
  ].sort();
  return sortKeys({ ...current, matrix: { ...current.matrix, viewports }, pages });
}

function describe(row) {
  const numbers = WORSENING_FIELDS.concat('count')
    .filter((f) => row[f] !== undefined)
    .map((f) => `${f}=${row[f]}`);
  return [row.verdict, ...numbers].join(' ');
}

/** Pure: which pages each artifact planned (every result, blocked ones included). */
export function runScope(artifacts) {
  const scope = {};
  for (const artifact of artifacts) {
    const key = scenarioKey(artifact);
    scope[key] ??= new Set();
    for (const result of artifact.results) {
      if (result.persona === RATCHET_PERSONA && RATCHET_STATES.includes(result.state))
        scope[key].add(result.pattern);
    }
  }
  return Object.fromEntries(Object.entries(scope).map(([key, pages]) => [key, [...pages].sort()]));
}

/** Pure: the committed ledger's pages for the run's scenarios, so a dropped page is noticed. */
export function compareScope(committed, artifacts) {
  const scope = runScope(artifacts);
  for (const artifact of artifacts) {
    if (artifact.routeFilter?.length) continue; // a --routes subset only compares itself
    const key = scenarioKey(artifact);
    for (const [page, scenarios] of Object.entries(committed?.pages ?? {})) {
      if (scenarios[key] && !scope[key].includes(page)) scope[key].push(page);
    }
    scope[key].sort();
  }
  return scope;
}

function allowlistReason(allowlist, page, rule) {
  return allowlist.find((entry) => entry.page === page && entry.rule === rule);
}

/** Pure: Markdown summary from ledger + artifacts (screenshots) + allow-list. */
export function renderSummaryMarkdown({ ledger, artifacts, allowlist, compare, summaryDir }) {
  const totals = Object.fromEntries(
    RULES.map((rule) => [rule, { pass: 0, fail: 0, 'allow-listed': 0, blocked: 0, 'n/a': 0 }]),
  );
  const failing = [];
  const allowListed = [];
  const blocked = [];
  const screenshots = new Map();
  for (const artifact of artifacts) {
    for (const result of artifact.results) {
      if (result.screenshot)
        screenshots.set(`${result.pattern}|${scenarioKey(artifact)}`, result.screenshot);
    }
  }
  const shot = (page, scenario) => {
    const file = screenshots.get(`${page}|${scenario}`);
    return file
      ? `[screenshot](${path.relative(summaryDir, file).split(path.sep).join('/')})`
      : '—';
  };
  for (const [page, scenarios] of Object.entries(ledger.pages)) {
    for (const [scenario, rules] of Object.entries(scenarios)) {
      for (const [rule, row] of Object.entries(rules)) {
        totals[rule][row.verdict] = (totals[rule][row.verdict] ?? 0) + 1;
        if (row.verdict === 'fail')
          failing.push(
            `| ${page} | ${scenario} | ${rule} | ${describe(row)} | ${shot(page, scenario)} |`,
          );
        else if (row.verdict === 'allow-listed') {
          const entry = allowlistReason(allowlist, page, rule);
          allowListed.push(
            `| ${page} | ${scenario} | ${rule} | ${entry?.class ?? '—'} | ${entry?.reason || row.reason || '(no reason)'} | ${entry?.reverifiedAt ?? '—'} | ${shot(page, scenario)} |`,
          );
        } else if (row.verdict === 'blocked')
          blocked.push(`| ${page} | ${scenario} | ${rule} | ${row.reason ?? '—'} |`);
      }
    }
  }
  const runs = artifacts.map(
    (a) =>
      `- \`${scenarioKey(a)}\` — app ${a.appCommit}, fixtures ${a.fixtureVersion}, planned ${a.summary.planned}, captured ${a.summary.captured}, blocked ${a.summary.blocked}, failed ${a.summary.failed}`,
  );
  const lines = [
    '# Page conformance summary',
    '',
    `Pages in ledger: ${Object.keys(ledger.pages).length} · scenarios: ${ledger.matrix.viewports.join(', ')} · persona: ${ledger.matrix.personas.join(', ')} · state: ${ledger.matrix.state}`,
    '',
    '## Runs',
    '',
    ...runs,
    '',
    '## Per-rule totals',
    '',
    '| rule | pass | fail | allow-listed | blocked | n/a |',
    '|---|---|---|---|---|---|',
    ...RULES.map(
      (rule) =>
        `| ${rule} | ${totals[rule].pass} | ${totals[rule].fail} | ${totals[rule]['allow-listed']} | ${totals[rule].blocked} | ${totals[rule]['n/a']} |`,
    ),
    '',
    `## Failing (${failing.length})`,
    '',
    ...(failing.length
      ? ['| page | scenario | rule | measured | evidence |', '|---|---|---|---|---|', ...failing]
      : ['None.']),
    '',
    `## Allow-listed (${allowListed.length})`,
    '',
    ...(allowListed.length
      ? [
          '| page | scenario | rule | class | reason | re-verified | evidence |',
          '|---|---|---|---|---|---|---|',
          ...allowListed,
        ]
      : ['None.']),
    '',
    `## Blocked (${blocked.length})`,
    '',
    ...(blocked.length
      ? ['| page | scenario | rule | reason |', '|---|---|---|---|', ...blocked]
      : ['None.']),
  ];
  if (compare) {
    lines.push('', '## Compare against the committed ledger', '');
    lines.push(
      `Regressions: ${compare.regressions.length} · improvements: ${compare.improvements.length}`,
      '',
    );
    for (const item of compare.regressions) lines.push(`- REGRESSION ${item}`);
    for (const item of compare.improvements) lines.push(`- improved ${item}`);
  }
  return `${lines.join('\n')}\n`;
}

const escapeHtml = (text) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Minimal Markdown → HTML for the summary's own shapes (headings, tables, lists, links). */
export function renderSummaryHtml(markdown) {
  const inline = (text) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  const out = [];
  let table = null;
  const flush = () => {
    if (table) out.push(`<table>${table.join('')}</table>`);
    table = null;
  };
  for (const line of markdown.split('\n')) {
    if (line.startsWith('|')) {
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;
      const tag = table ? 'td' : 'th';
      table ??= [];
      table.push(`<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`);
      continue;
    }
    flush();
    const heading = line.match(/^(#+) (.*)$/);
    if (heading) out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    else if (line.startsWith('- ')) out.push(`<li>${inline(line.slice(2))}</li>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return `<!doctype html><meta charset="utf-8"><title>Page conformance summary</title><style>body{font:14px system-ui;margin:2rem;max-width:72rem}table{border-collapse:collapse;margin:1rem 0}td,th{border:1px solid #ccc;padding:.25rem .5rem;text-align:left}code{background:#eee;padding:0 .25rem}</style>${out.join('\n')}\n`;
}

export function readArtifacts(files) {
  const artifacts = files.map((file) => ({ file, data: JSON.parse(readFileSync(file, 'utf8')) }));
  for (const { file, data } of artifacts) {
    if (!Array.isArray(data.results) || !data.exactViewport?.id || !data.pointer) {
      throw new Error(
        `${file} is not a route-audit run artifact (expected results[], exactViewport.id, pointer)`,
      );
    }
    if ((data.schemaVersion ?? 0) < 4)
      console.warn(
        `ui-audit-conformance: ${file} is schema v${data.schemaVersion}; rows without conformance evidence become blocked`,
      );
  }
  return artifacts.map(({ data }) => data);
}

export function readAllowlist(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

export function main(argv, root = path.join(fileURLToPath(import.meta.url), '..', '..')) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const files = argv.filter((arg) => !arg.startsWith('--'));
  const paths = ledgerPaths(root);
  const log = (msg) => console.log(`ui-audit-conformance: ${msg}`);
  if (!files.length || !['--compare', '--update-ledger', '--summary'].some((f) => flags.has(f))) {
    console.error(
      'usage: ui-audit-conformance.mjs (--compare|--update-ledger|--summary)… [--ci] run.json…',
    );
    return 2;
  }
  const artifacts = readArtifacts(files);
  const allowlist = readAllowlist(paths.allowlist);
  const current = buildLedger(artifacts);
  const committed = existsSync(paths.ledger)
    ? JSON.parse(readFileSync(paths.ledger, 'utf8'))
    : null;
  let compare = null;
  let exit = 0;

  if (flags.has('--compare') || flags.has('--update-ledger')) {
    if (!committed && !flags.has('--update-ledger')) {
      log(
        `blocked: no ledger yet (${path.relative(root, paths.ledger)} missing) — the first full run commits it with --update-ledger`,
      );
    } else {
      compare = committed
        ? compareLedgers(committed, current, allowlist, compareScope(committed, artifacts))
        : { regressions: [], improvements: [] }; // first ledger: nothing to compare against
      for (const item of compare.regressions)
        console.error(`ui-audit-conformance: REGRESSION ${item}`);
      for (const item of compare.improvements) log(`improved ${item}`);
      if (compare.regressions.length) {
        log(
          `${compare.regressions.length} regression(s); refusing to ${flags.has('--update-ledger') ? 'rewrite the ledger' : 'pass'}`,
        );
        exit = 1;
      } else if (flags.has('--update-ledger')) {
        mkdirSync(path.dirname(paths.ledger), { recursive: true });
        const next = committed ? mergeLedger(committed, current) : current;
        writeFileSync(paths.ledger, `${JSON.stringify(next, null, 2)}\n`);
        log(
          `ledger ${committed ? 'ratcheted' : 'created'} → ${path.relative(root, paths.ledger)} (${Object.keys((committed ? mergeLedger(committed, current) : current).pages).length} pages)`,
        );
      } else if (compare.improvements.length) {
        log(
          `${compare.improvements.length} improvement(s): ledger can be ratcheted (run with --update-ledger and commit it)`,
        );
        if (!flags.has('--ci')) exit = 1;
      } else {
        log('ledger unchanged');
      }
    }
  }

  if (flags.has('--summary')) {
    mkdirSync(paths.summaryDir, { recursive: true });
    const markdown = renderSummaryMarkdown({
      ledger: current,
      artifacts,
      allowlist,
      compare,
      summaryDir: paths.summaryDir,
    });
    writeFileSync(path.join(paths.summaryDir, 'summary.md'), markdown);
    writeFileSync(path.join(paths.summaryDir, 'summary.html'), renderSummaryHtml(markdown));
    const failingDir = path.join(paths.summaryDir, 'failing');
    for (const artifact of artifacts) {
      const scenario = scenarioKey(artifact);
      for (const result of artifact.results) {
        const row = current.pages[result.pattern]?.[scenario];
        if (!row || !result.screenshot || !existsSync(result.screenshot)) continue;
        if (Object.values(row).some((rule) => rule.verdict === 'fail')) {
          mkdirSync(failingDir, { recursive: true });
          copyFileSync(result.screenshot, path.join(failingDir, path.basename(result.screenshot)));
        }
      }
    }
    log(`summary → ${path.relative(root, paths.summaryDir)}/summary.{md,html}`);
  }
  return exit;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
