/**
 * Page archetype composition contract (spec 013, FR-004; `contracts/ui.md`
 * §Archetype manifest, reconciled with `route-design-manifest.ts`).
 *
 * The archetype vocabulary is the ONE in `ROUTE_DESIGN_MANIFEST` (`RouteArchetype`).
 * A screen "composes like its archetype" when the markup it renders — its own
 * `+page.svelte`, the `(app)` layouts above it, and the `$lib/components/*`
 * (non-`ui/`) components it mounts — contains the archetype's recipe:
 *
 * | archetype                 | must compose                                                         |
 * | ------------------------- | -------------------------------------------------------------------- |
 * | `collection`              | PageShell + PageHeader + one toolbar (DataView/FilterToolbar/DataTable) + a scroll owner |
 * | `record-detail`           | PageShell + PageHeader or DetailHeader                               |
 * | `form-settings`           | a settings section shell (SectionShell/SettingsNav), or PageShell + a form commit |
 * | `dashboard`               | PageShell + EditableGrid or a KPI grid                               |
 * | `master-detail`           | PageShell + PageHeader                                               |
 * | `workspace-editor`        | SectionShell or PageShell                                            |
 * | `canvas-kanban`           | PageShell                                                            |
 * | `terminal-remote-desktop` | PageShell                                                            |
 * | `public-auth`             | no composition contract (outside the app shell)                      |
 *
 * The check is textual on purpose: it runs in the plain vitest lane, needs no
 * DOM and fails the moment a page drops a shell or a header.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { RouteArchetype as PageShellArchetype } from '$lib/components/ui/foundations/PageShell.svelte';
import type { RouteArchetype } from './route-design-manifest';

export const APP_ROUTES_DIR = 'src/routes/(app)';
const LIB_DIR = 'src/lib';

/** Manifest archetype → the `data-archetype` PageShell renders (one vocabulary, two spellings). */
export const PAGE_SHELL_ARCHETYPE: Readonly<Record<RouteArchetype, PageShellArchetype>> = {
  dashboard: 'dashboard',
  collection: 'collection',
  'record-detail': 'record-detail',
  'form-settings': 'form',
  'master-detail': 'master-detail',
  'workspace-editor': 'workspace',
  'canvas-kanban': 'canvas',
  'terminal-remote-desktop': 'terminal',
  'public-auth': 'public',
};

/**
 * The ONE hand-maintained allow-list (spec 014, FR-007): `tests/ui-audit/conformance-allowlist.json`.
 * Both static maps below derive from it; the rendered-DOM harness
 * (`tests/e2e/ui-audit/conformance.ts`) reads the same file, so the two can never disagree.
 * `class: null` / `reverifiedAt: null` = not yet re-verified by a rendered run (first full run fills them).
 */
export type ConformanceAllowlistClass =
  'archetype-corrected' | 'owns-composition' | 'adoption-debt';
export interface ConformanceAllowlistEntry {
  page: string;
  rule: 'overflow' | 'targets' | 'dominant-action' | 'archetype' | 'health' | 'title';
  class: ConformanceAllowlistClass | null;
  reason: string;
  reverifiedAt: string | null;
  followUp?: string;
}
export const CONFORMANCE_ALLOWLIST_FILE = 'tests/ui-audit/conformance-allowlist.json';
// readFileSync (cwd-relative, like APP_ROUTES_DIR) so vitest, Playwright and svelte-check load it alike.
export const CONFORMANCE_ALLOWLIST = JSON.parse(
  readFileSync(CONFORMANCE_ALLOWLIST_FILE, 'utf8'),
) as readonly ConformanceAllowlistEntry[];

const byPage = (entries: readonly ConformanceAllowlistEntry[]) =>
  Object.fromEntries(entries.map((entry) => [entry.page, entry.reason])) as Readonly<
    Record<string, string>
  >;

/**
 * Screens that do not compose like their archetype today — debt with a reason.
 * The test fails when an entry starts conforming (remove it) and when a screen
 * NOT listed here stops conforming. Never add an entry to make a new page pass.
 */
export const KNOWN_NONCONFORMING = byPage(
  CONFORMANCE_ALLOWLIST.filter((e) => e.rule === 'archetype' && e.class !== 'archetype-corrected'),
);

/**
 * Screens whose literal `<PageShell archetype>` disagrees with the manifest
 * (`class: "archetype-corrected"`). Each is debt to reconcile (flip one side) — the
 * test fails on any NEW drift and when an entry is resolved.
 */
export const KNOWN_ARCHETYPE_DRIFT = byPage(
  CONFORMANCE_ALLOWLIST.filter((e) => e.rule === 'archetype' && e.class === 'archetype-corrected'),
);

/** `src/routes/(app)/stock/items/[id]/+page.svelte` for `/stock/items/[id]`, or null when the
 *  pattern lives outside the app group (public routes). */
export function appPageFile(pattern: string): string | null {
  const file = join(APP_ROUTES_DIR, pattern, '+page.svelte');
  return existsSync(file) ? file : null;
}

/** Markup only: script, style, comments and `<svelte:head>` removed. */
export function markupOf(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svelte:head>[\s\S]*?<\/svelte:head>/g, '')
    .trim();
}

/** Every `(app)` `+layout.svelte` from the group root down to the page's folder. */
export function layoutChain(pageFile: string): string[] {
  const out: string[] = [];
  let dir = dirname(pageFile);
  while (dir.length >= APP_ROUTES_DIR.length) {
    const layout = join(dir, '+layout.svelte');
    if (existsSync(layout)) out.unshift(layout);
    if (dir === APP_ROUTES_DIR) break;
    dir = dirname(dir);
  }
  return out;
}

/** `$lib/components/<area>/X.svelte` imports (not `ui/`) whose tag appears in the markup. */
function delegateComponents(source: string, body: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(
    /import\s+(\w+)\s+from\s+'\$lib\/components\/(?!ui\/)([^']+\.svelte)'/g,
  )) {
    if (new RegExp(`<${m[1]}[\\s>/]`).test(body)) out.push(resolve(LIB_DIR, 'components', m[2]));
  }
  return out;
}

/**
 * The markup a page renders, one delegation level deep: own page, ancestor
 * layouts, and the area components it mounts (`BookingsView`,
 * `SellableEditorPage`, …) — those own the shell on wrapper-only pages.
 */
export function composedSource(pageFile: string): string {
  const own = readFileSync(pageFile, 'utf8');
  const body = markupOf(own);
  const parts = [...layoutChain(pageFile), ...delegateComponents(own, body)]
    .filter((f) => existsSync(f))
    .map((f) => markupOf(readFileSync(f, 'utf8')));
  return [body, ...parts].join('\n');
}

/** Literal `archetype="…"` the page (or its layout chain) hands PageShell, if any. */
export function declaredPageShellArchetype(source: string): string | null {
  return /<PageShell[^>]*\sarchetype="([a-z-]+)"/.exec(source)?.[1] ?? null;
}

const has = (src: string, tag: string) => new RegExp(`<${tag}[\\s>/]`).test(src);
const SCROLL_OWNER =
  /scroll="region"|scroll=\{routeShell\.scroll\}|<PageBody[\s>]|overflow(-y)?-auto|overflow(-y)?:\s*auto/;
const TOOLBAR = /<(DataView|FilterToolbar|DataTable)[\s>/]/;
const FORM_COMMIT =
  /type="submit"|onsubmit|<form[\s>]|FormFooter|SaveIndicator|ConfigSaveBar|data-part="form-footer"|m\.\w*save\w*\(/i;
const KPI_GRID = /<(EditableGrid|KpiRow)[\s>/]|kpi/;

/** Empty = conforms. Each entry names the missing primitive. */
export function compositionFailures(archetype: RouteArchetype, source: string): string[] {
  const out: string[] = [];
  const need = (ok: boolean, what: string) => {
    if (!ok) out.push(what);
  };
  const shell = () => need(has(source, 'PageShell'), 'PageShell');
  switch (archetype) {
    case 'collection':
      shell();
      need(has(source, 'PageHeader'), 'PageHeader');
      need(TOOLBAR.test(source), 'one toolbar (DataView | FilterToolbar | DataTable)');
      need(SCROLL_OWNER.test(source), 'a region that owns scroll');
      break;
    case 'record-detail':
      shell();
      need(has(source, 'PageHeader') || has(source, 'DetailHeader'), 'PageHeader | DetailHeader');
      break;
    case 'form-settings':
      need(
        has(source, 'SectionShell') ||
          has(source, 'SettingsNav') ||
          (has(source, 'PageShell') && FORM_COMMIT.test(source)),
        'SectionShell | SettingsNav, or PageShell + a form commit',
      );
      break;
    case 'dashboard':
      shell();
      need(KPI_GRID.test(source), 'EditableGrid | KPI grid');
      break;
    case 'master-detail':
      shell();
      need(has(source, 'PageHeader'), 'PageHeader');
      break;
    case 'workspace-editor':
      need(has(source, 'SectionShell') || has(source, 'PageShell'), 'SectionShell | PageShell');
      break;
    case 'canvas-kanban':
    case 'terminal-remote-desktop':
      shell();
      break;
    case 'public-auth':
      break;
  }
  return out;
}

/** Layout files under `(app)` that own a shell — used by the layout-awareness proof. */
export function shellOwningLayouts(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name === '+layout.svelte' ? [p] : [];
    });
  return walk(APP_ROUTES_DIR).filter((f) =>
    /<(PageShell|SectionShell)[\s>]/.test(readFileSync(f, 'utf8')),
  );
}
