// Pure scan + diff for the house-rules counters. Spec 138 H1.
// walk/strip follow scripts/dataset-read-baseline.mjs (which does not export them).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SKIP_DIR = /(^|\/)(node_modules|_test|fixtures|__fixtures__)$|^src\/lib\/stories$/;
const SKIP_FILE = /\.(test|spec)\./;

export function walk(root, dir, exts, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIR.test(rel)) walk(root, rel, exts, out);
    } else if (exts.some((x) => e.name.endsWith(x)) && !SKIP_FILE.test(e.name)) out.push(rel);
  }
  return out;
}

// shortcut: `//` inside a string literal other than after `:` is stripped; upgrade if a counter misreads.
export const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Text of every <script> block of a .svelte file; the whole text for other files. */
export function scriptText(file, text) {
  if (!file.endsWith('.svelte')) return text;
  return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}

/** Counts calls to the browser confirm. */
export const countConfirm = (text) => {
  const s = strip(text).replace(/function\s+confirm\s*\(/g, '');
  return (s.match(/(^|[^.\w$])confirm\(|(window|globalThis)\.confirm\(/g) ?? []).length;
};

/** 1 when the file imports Modal.svelte or the name `Modal` from $lib/components/ui. */
export const importsDeprecatedModal = (file, text) => {
  const sf = ts.createSourceFile('x.ts', scriptText(file, text), ts.ScriptTarget.ES2022);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (/(^|\/)Modal\.svelte$/.test(spec)) return 1;
    if (/^\$lib\/components\/ui(\/index(\.ts)?)?$/.test(spec)) {
      const named = st.importClause?.namedBindings;
      if (named && ts.isNamedImports(named))
        if (named.elements.some((el) => (el.propertyName ?? el.name).text === 'Modal')) return 1;
    }
  }
  return 0;
};

/** 1 when a write-method fetch appears in the file. */
export const sendsRawWrite = (text) =>
  /fetch\([\s\S]{0,300}?method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(strip(text)) ? 1 : 0;

const API_SERVER = /^src\/routes\/api\/.*\/\+server\.ts$/;
const WRITE_EXPORT =
  /export\s+(?:const|async\s+function|function)\s+(POST|PUT|PATCH|DELETE)\b|export\s*\{[^}]*\b(POST|PUT|PATCH|DELETE)\b[^}]*\}/;

/** 1 for an API route that exports a write method, reads request.json() and never calls parseBody(. */
export const rawRequestJson = (file, text) => {
  if (!API_SERVER.test(file)) return 0;
  const s = strip(text);
  return WRITE_EXPORT.test(s) && s.includes('request.json()') && !s.includes('parseBody(') ? 1 : 0;
};

/** Counts hand-written 401 guards: `if (!ctx) throw error(401`. */
export const countHand401 = (text) =>
  (strip(text).match(/if \(!\w+\) throw error\(401/g) ?? []).length;

/** { ruleId: { file: n } } for the counted rules; files with 0 are omitted. */
export function scan(rules, root) {
  const out = {};
  for (const rule of rules.filter((r) => r.kind === 'count')) {
    const counts = (out[rule.id] = {});
    const skip = new Set(rule.exceptions.map((e) => e.path));
    for (const file of walk(root, 'src', rule.exts)) {
      if (skip.has(file)) continue;
      const n = rule.match(file, fs.readFileSync(path.join(root, file), 'utf8'));
      if (n > 0) counts[file] = n;
    }
  }
  return out;
}

/** Violations of the ratchet: raised, new (absent from baseline), stale (baseline too high). */
export function diff(current, baseline) {
  const v = [];
  for (const rule of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const cur = current[rule] ?? {};
    const base = baseline[rule] ?? {};
    for (const file of new Set([...Object.keys(cur), ...Object.keys(base)])) {
      const now = cur[file] ?? 0;
      const was = base[file];
      if (was === undefined) v.push({ rule, file, kind: 'new', was: 0, now });
      else if (now > was) v.push({ rule, file, kind: 'raised', was, now });
      else if (now < was) v.push({ rule, file, kind: 'stale', was, now });
    }
  }
  return v;
}
