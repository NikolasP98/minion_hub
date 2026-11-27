// Write-endpoint inventory. Spec 138 H5. Loaded only by write-inventory.test.ts so `$server` resolves.
// Known blind spots: handlers that re-export another route's handler, local wrappers such as `hrCtx`,
// and catch-all routes scored as one URL.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { apiWriteCapability } from '$server/services/rbac.service';
import { strip, walk } from './scan.mjs';

export const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type Guard =
  | 'requireOrgCapability'
  | 'requireAdmin'
  | 'assistant-principal'
  | 'server-token'
  | 'requireAuth'
  | 'requireFeature'
  | 'ctx-only'
  | 'none';

export type Entry = {
  file: string;
  methods: string[];
  guard: Guard;
  class: string;
  reason: string;
  fileLevel?: true;
};
export type Inventory = { todoCeiling: number; entries: Entry[] };
export type Found = Omit<Entry, 'class' | 'reason'>;

/** `src/routes/api/foo/[id]/(g)/bar/+server.ts` -> `/api/foo/x/bar`. */
export const urlFor = (file: string) =>
  '/' +
  path.posix
    .dirname(file)
    .replace(/^src\/routes\//, '')
    .split('/')
    .filter((s) => !/^\(.*\)$/.test(s))
    .map((s) => (/^\[.*\]$/.test(s) ? 'x' : s))
    .join('/');

export const enumerate = (root: string) =>
  walk(root, 'src/routes/api', ['+server.ts']).filter((f) => f.endsWith('/+server.ts'));

/** Text of each exported write handler; `null` when the body cannot be isolated. */
export function writeHandlers(text: string): Record<string, string | null> {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.ES2022, true);
  const decls = new Map<string, ts.Node>(); // top-level name -> node holding its body
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) decls.set(st.name.text, st);
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer) decls.set(d.name.text, d.initializer);
  }
  const out: Record<string, string | null> = {};
  const isExported = (n: ts.Node) =>
    ts.canHaveModifiers(n) &&
    (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const bodyOf = (node: ts.Node | undefined, depth = 0): string | null => {
    if (!node) return null;
    if (ts.isIdentifier(node) && depth < 3) return bodyOf(decls.get(node.text), depth + 1);
    if (ts.isIdentifier(node)) return null;
    return node.getText(sf);
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && isExported(st) && st.name) out[st.name.text] = bodyOf(st);
    else if (ts.isVariableStatement(st) && isExported(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name)) out[d.name.text] = bodyOf(d.initializer);
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause)
      if (ts.isNamedExports(st.exportClause))
        for (const el of st.exportClause.elements)
          out[el.name.text] = bodyOf((el.propertyName ?? el.name) as ts.Identifier);
  }
  return Object.fromEntries(
    Object.entries(out)
      .filter(([k]) => (WRITE_METHODS as readonly string[]).includes(k))
      .map(([k, v]) => [k, v === null ? null : strip(v)]),
  );
}

const has = (t: string, ...names: string[]) => names.some((n) => new RegExp(`\\b${n}\\b`).test(t));

/** Strongest helper named in the file, in this precedence: requireOrgCapability, requireAdmin,
 * assistant-principal, server-token, requireAuth, requireFeature, ctx-only, none. */
export function detectGuard(text: string): Guard {
  const t = strip(text);
  if (has(t, 'requireOrgCapability')) return 'requireOrgCapability';
  if (has(t, 'requireAdmin')) return 'requireAdmin';
  if (has(t, 'requireAssistantCapability', 'resolveAssistantPrincipal'))
    return 'assistant-principal';
  if (has(t, 'requireServerToken') || /locals\.serverId/.test(t)) return 'server-token';
  if (has(t, 'requireAuth')) return 'requireAuth';
  if (has(t, 'requireFeature')) return 'requireFeature';
  if (
    has(
      t,
      'getCoreCtx',
      'requireCoreCtx',
      'getServerCtx',
      'datasetCtx',
      'requireDataset',
      'requireTenantCtx',
      'getTenantCtx',
    ) ||
    /locals\.tenantCtx/.test(t)
  )
    return 'ctx-only';
  return 'none';
}

/** Files with at least one write method that is neither prefix-gated nor calls requireOrgCapability. */
export function inventory(root: string): { found: Found[]; stats: Stats } {
  const found: Found[] = [];
  const stats: Stats = { files: 0, handlers: 0, uncoveredFiles: 0, uncoveredMethods: 0 };
  for (const file of enumerate(root)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const handlers = writeHandlers(text);
    const methods = Object.keys(handlers).sort();
    if (!methods.length) continue;
    stats.files++;
    stats.handlers += methods.length;
    const url = urlFor(file);
    let fileLevel = false;
    const uncovered = methods.filter((m) => {
      if (apiWriteCapability(url, m)) return false;
      const body = handlers[m];
      if (body === null) fileLevel = true;
      return !has(body ?? strip(text), 'requireOrgCapability');
    });
    if (!uncovered.length) continue;
    stats.uncoveredFiles++;
    stats.uncoveredMethods += uncovered.length;
    found.push({
      file,
      methods: uncovered,
      guard: detectGuard(text),
      ...(fileLevel ? { fileLevel: true as const } : {}),
    });
  }
  return { found: found.sort((a, b) => a.file.localeCompare(b.file)), stats };
}
export type Stats = {
  files: number;
  handlers: number;
  uncoveredFiles: number;
  uncoveredMethods: number;
};

export type Violation = {
  kind: 'new' | 'stale' | 'changed' | 'todo-ceiling';
  file?: string;
  detail: string;
};

export function diffInventory(current: Found[], committed: Inventory): Violation[] {
  const v: Violation[] = [];
  const cur = new Map(current.map((e) => [e.file, e]));
  const com = new Map(committed.entries.map((e) => [e.file, e]));
  for (const [file, e] of cur) {
    const c = com.get(file);
    if (!c) v.push({ kind: 'new', file, detail: `${e.methods.join(',')} guard=${e.guard}` });
    else if (c.methods.join() !== e.methods.join() || c.guard !== e.guard)
      v.push({
        kind: 'changed',
        file,
        detail: `committed ${c.methods.join(',')}/${c.guard}, now ${e.methods.join(',')}/${e.guard}`,
      });
  }
  for (const file of com.keys())
    if (!cur.has(file)) v.push({ kind: 'stale', file, detail: 'fully covered or gone' });
  const todo = committed.entries.filter((e) => e.class === 'todo').length;
  if (todo > committed.todoCeiling)
    v.push({
      kind: 'todo-ceiling',
      detail: `${todo} todo entries, ceiling ${committed.todoCeiling}`,
    });
  return v;
}

/** Update mode: keep class and reason of listed files, add new ones as todo, drop stale ones. */
export function mergeInventory(found: Found[], committed: Inventory): Inventory {
  const com = new Map(committed.entries.map((e) => [e.file, e]));
  const entries = found.map((f): Entry => {
    const c = com.get(f.file);
    return { ...f, class: c?.class ?? 'todo', reason: c?.reason ?? 'not yet classified' };
  });
  const todo = entries.filter((e) => e.class === 'todo').length;
  return { todoCeiling: Math.min(committed.todoCeiling, todo), entries };
}
