/**
 * Content contract (spec 013 FR-009, rescoped per analysis §2.10 / F5).
 *
 * 1. Verb glossary: every catalog key whose EN text is one of the glossary
 *    verbs maps to the glossary's ES verb. Divergences fail by key; the few
 *    nouns that share an EN spelling with a verb are allow-listed with a reason.
 * 2. Whole-catalog divergence ratchet: the set of EN texts that two or more
 *    keys share while their ES texts differ may only shrink.
 * 3. Formatter ratchet: `toLocaleString` / `toFixed` / `Intl.*` /
 *    `toLocaleDateString` / `toLocaleTimeString` calls outside
 *    `$lib/utils/format.ts`, counted per file, may only decrease — a new file
 *    or a higher count fails. Money and dates render through `formatMoney` /
 *    `formatDate`.
 *
 * Refresh the baseline (decrease-only) with:
 *   CONTENT_CONTRACT_UPDATE_BASELINE=1 bunx vitest run scripts/qc/content-contract.test.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, 'scripts/qc/.content-contract-baseline.json');
const UPDATE = process.env.CONTENT_CONTRACT_UPDATE_BASELINE === '1';

type Catalog = Record<string, string>;
const en = JSON.parse(readFileSync(join(ROOT, 'messages/en.json'), 'utf8')) as Catalog;
const es = JSON.parse(readFileSync(join(ROOT, 'messages/es.json'), 'utf8')) as Catalog;

interface Baseline {
  /** EN texts shared by ≥2 keys whose ES texts differ (sorted). */
  divergentTexts: string[];
  /** Relative file → number of formatter-bypass call sites. */
  formatterBypasses: Record<string, number>;
}
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;

// ── 1. Verb glossary ────────────────────────────────────────────────────────
const VERBS: Record<string, string> = {
  verb_save: 'Save',
  verb_cancel: 'Cancel',
  verb_create: 'Create',
  verb_delete: 'Delete',
  verb_archive: 'Archive',
  verb_restore: 'Restore',
  verb_retry: 'Retry',
  verb_review: 'Review',
  verb_export: 'Export',
  verb_import: 'Import',
};
/** EN text equals a verb but the key is a noun/title, so its ES is legitimately different. */
const VERB_NOUN_KEYS: Record<string, string> = {
  workforce_trace_categoryRetry: 'trace category label ("Reintento" the event, not the action)',
  workshop_convArchive: 'section header for archived conversations ("Archivo" the place)',
  stock_review_title: 'wizard step title ("Revisión" the step, not the action)',
  stock_step_review: 'wizard step label ("Revisión" the step, not the action)',
};

describe('content contract: verb glossary', () => {
  it('ships every glossary verb in both catalogs', () => {
    for (const [key, text] of Object.entries(VERBS)) {
      expect(en[key], key).toBe(text);
      expect(typeof es[key], key).toBe('string');
    }
  });

  it('maps every key with a glossary EN verb to the glossary ES verb', () => {
    const esByVerb = new Map(Object.entries(VERBS).map(([key, text]) => [text, es[key]]));
    const divergent: string[] = [];
    for (const [key, text] of Object.entries(en)) {
      const expected = esByVerb.get(text);
      if (expected === undefined || key in VERB_NOUN_KEYS) continue;
      if (es[key] !== expected)
        divergent.push(`${key}: EN "${text}" → ES "${es[key]}" (glossary: "${expected}")`);
    }
    expect(divergent, divergent.join('\n')).toEqual([]);
  });

  it('keeps every allow-listed noun key alive and actually divergent', () => {
    for (const key of Object.keys(VERB_NOUN_KEYS)) {
      expect(Object.values(VERBS), key).toContain(en[key]);
      const verbKey = Object.keys(VERBS).find((k) => VERBS[k] === en[key])!;
      expect(es[key], `${key} now matches the glossary — drop it from the allow-list`).not.toBe(
        es[verbKey],
      );
    }
  });
});

// ── 2. Whole-catalog divergence ratchet ─────────────────────────────────────
function divergentTexts(): string[] {
  const keysByText = new Map<string, string[]>();
  for (const [key, text] of Object.entries(en)) {
    if (!keysByText.has(text)) keysByText.set(text, []);
    keysByText.get(text)!.push(key);
  }
  return [...keysByText]
    .filter(([, keys]) => keys.length > 1 && new Set(keys.map((k) => es[k])).size > 1)
    .map(([text]) => text)
    .sort();
}

// ── 3. Formatter bypass ratchet ─────────────────────────────────────────────
const FORMATTER_HOME = 'src/lib/utils/format.ts';
const BYPASS =
  /\.toLocaleString\(|\.toFixed\(|\bIntl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat)\(|\.toLocaleDateString\(|\.toLocaleTimeString\(/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(svelte|ts)$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name))
      out.push(path);
  }
  return out;
}

function formatterBypasses(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(join(ROOT, 'src')).sort()) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (rel === FORMATTER_HOME) continue;
    const hits = readFileSync(file, 'utf8').match(BYPASS)?.length ?? 0;
    if (hits > 0) counts[rel] = hits;
  }
  return counts;
}

describe('content contract: ratchets', () => {
  const texts = divergentTexts();
  const bypasses = formatterBypasses();

  it('EN texts with divergent ES translations only ever shrink', () => {
    const known = new Set(baseline.divergentTexts);
    const added = texts.filter((t) => !known.has(t));
    expect(
      added,
      `new divergent EN texts (fix the ES or translate consistently):\n${added.join('\n')}`,
    ).toEqual([]);
  });

  it('formatter bypasses per file only ever decrease', () => {
    const regressions: string[] = [];
    for (const [file, count] of Object.entries(bypasses)) {
      const allowed = baseline.formatterBypasses[file] ?? 0;
      if (count > allowed)
        regressions.push(
          `${file}: ${count} > ${allowed} — route money through formatMoney and dates through formatDate`,
        );
    }
    expect(regressions, regressions.join('\n')).toEqual([]);
  });

  it('the baseline never lists bypasses that no longer exist (decrease-only refresh)', () => {
    const stale = Object.entries(baseline.formatterBypasses).filter(
      ([file, count]) => (bypasses[file] ?? 0) < count,
    );
    const staleTexts = baseline.divergentTexts.filter((t) => !texts.includes(t));
    if (UPDATE) {
      const next: Baseline = { divergentTexts: texts, formatterBypasses: bypasses };
      writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
      return;
    }
    const hint = 'refresh with CONTENT_CONTRACT_UPDATE_BASELINE=1 so the ratchet tightens';
    expect(
      stale.map(([f]) => f),
      `baseline overstates: ${hint}`,
    ).toEqual([]);
    expect(staleTexts, `baseline overstates divergent texts: ${hint}`).toEqual([]);
  });
});
