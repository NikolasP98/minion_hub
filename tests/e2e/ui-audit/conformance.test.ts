// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { ConformanceAllowlistEntry } from '../../../src/lib/routes/archetype-composition';
import {
  CONFORMANCE_RULES,
  blockedConformance,
  evaluateArchetype,
  evaluateConformance,
  type ConformanceContext,
} from './conformance';
import { runtimeUiDiagnosticsInBrowser, type RuntimeUiDiagnostics } from './runtime-diagnostics';

const noEvents = { consoleErrors: [], pageErrors: [], failedSameOriginGets: [] };
const collection: ConformanceContext = {
  pattern: '/stock/items',
  archetype: 'collection',
  pointer: 'coarse',
};

const clean: RuntimeUiDiagnostics = {
  documentOverflowPx: 0,
  documentOverflowAllowed: false,
  duplicateIds: [],
  unnamedInteractiveElements: [],
  unnamedDialogs: [],
  buttonsMissingTypeInForms: [],
  invalidLocalLinks: [],
  visibleRouteTitles: ['Items'],
  undersizedInteractiveElements: [],
  denseRegions: ['data-table'],
  pageShellArchetype: 'collection',
  landmarks: ['data-table', 'page-header', 'page-shell'],
  primaryHeaderActions: ['#new-item'],
  formRendered: false,
};

describe('conformance rules (spec 014)', () => {
  it('passes a clean collection page on every rule', () => {
    const evidence = evaluateConformance(clean, collection, noEvents, []);
    expect(CONFORMANCE_RULES.map((rule) => evidence[rule].verdict)).toEqual(Array(6).fill('pass'));
    expect(evidence.overflow.px).toBe(0);
    expect(evidence.targets).toMatchObject({ undersized: 0, dense: ['data-table'] });
    expect(evidence['dominant-action'].primary).toBe(1);
    expect(evidence.title.count).toBe(1);
  });

  it('overflow: fails on any px, allow-listed when the surface declares it', () => {
    expect(
      evaluateConformance({ ...clean, documentOverflowPx: 12 }, collection, noEvents, []).overflow,
    ).toEqual({ verdict: 'fail', px: 12 });
    expect(
      evaluateConformance(
        { ...clean, documentOverflowPx: 12, documentOverflowAllowed: true },
        collection,
        noEvents,
        [],
      ).overflow,
    ).toMatchObject({
      verdict: 'allow-listed',
      px: 12,
      reason: 'data-allow-document-overflow="true"',
    });
  });

  it('targets: fails with the offending selectors, n/a for fine pointer and exempt archetypes', () => {
    const sized = { ...clean, undersizedInteractiveElements: ['#tiny', 'button:nth-of-type(2)'] };
    expect(evaluateConformance(sized, collection, noEvents, []).targets).toEqual({
      verdict: 'fail',
      undersized: 2,
      dense: ['data-table'],
      offenders: ['#tiny', 'button:nth-of-type(2)'],
    });
    expect(
      evaluateConformance(sized, { ...collection, pointer: 'fine' }, noEvents, []).targets.verdict,
    ).toBe('n/a');
    expect(
      evaluateConformance(sized, { ...collection, archetype: 'canvas-kanban' }, noEvents, [])
        .targets.verdict,
    ).toBe('n/a');
  });

  it('dominant-action: 0 and 1 primary pass, 2 fail naming both, n/a without a header', () => {
    const count = (primaryHeaderActions: string[]) =>
      evaluateConformance({ ...clean, primaryHeaderActions }, collection, noEvents, [])[
        'dominant-action'
      ];
    expect(count([])).toEqual({ verdict: 'pass', primary: 0, offenders: [] });
    expect(count(['#a']).verdict).toBe('pass');
    expect(count(['#a', '#b'])).toEqual({ verdict: 'fail', primary: 2, offenders: ['#a', '#b'] });
    expect(
      evaluateConformance(
        { ...clean, landmarks: ['page-shell'], primaryHeaderActions: ['#a', '#b'] },
        collection,
        noEvents,
        [],
      )['dominant-action'],
    ).toEqual({ verdict: 'n/a', reason: 'no page-header rendered' });
  });

  it('health: fails with console, page and same-origin GET messages attached', () => {
    const events = {
      consoleErrors: ['boom'],
      pageErrors: [],
      failedSameOriginGets: ['500 /api/x'],
    };
    expect(evaluateConformance(clean, collection, events, []).health).toEqual({
      verdict: 'fail',
      offenders: ['console: boom', 'GET: 500 /api/x'],
    });
  });

  it('title: exactly one for title archetypes, n/a otherwise', () => {
    expect(
      evaluateConformance({ ...clean, visibleRouteTitles: ['A', 'B'] }, collection, noEvents, [])
        .title,
    ).toEqual({ verdict: 'fail', count: 2, offenders: ['A', 'B'] });
    expect(
      evaluateConformance(clean, { ...collection, archetype: 'workspace-editor' }, noEvents, [])
        .title.verdict,
    ).toBe('n/a');
  });

  it('archetype: landmark sets per archetype, fail names the missing group', () => {
    const page = (landmarks: string[], shell: string | null, formRendered = false) => ({
      landmarks,
      pageShellArchetype: shell,
      formRendered,
    });
    expect(
      evaluateArchetype(
        page(['page-shell', 'page-header', 'filter-toolbar'], 'collection'),
        'collection',
      ).verdict,
    ).toBe('pass');
    expect(
      evaluateArchetype(page(['page-shell', 'page-header'], 'collection'), 'collection'),
    ).toEqual({
      verdict: 'fail',
      missing: ['data-view | data-table | filter-toolbar'],
    });
    expect(
      evaluateArchetype(page(['page-shell', 'editable-grid'], 'dashboard'), 'dashboard').verdict,
    ).toBe('pass');
    expect(
      evaluateArchetype(page(['page-shell', 'kpi-grid'], 'dashboard'), 'dashboard').verdict,
    ).toBe('pass');
    expect(evaluateArchetype(page(['page-shell'], 'dashboard'), 'dashboard').missing).toEqual([
      'editable-grid | kpi-grid',
    ]);
    expect(
      evaluateArchetype(page(['page-shell', 'detail-header'], 'record-detail'), 'record-detail')
        .verdict,
    ).toBe('pass');
    expect(
      evaluateArchetype(page(['page-shell'], 'record-detail'), 'record-detail').missing,
    ).toEqual(['page-header | detail-header']);
    expect(evaluateArchetype(page(['section-shell'], null), 'form-settings').verdict).toBe('pass');
    expect(evaluateArchetype(page(['page-shell'], 'form', true), 'form-settings').verdict).toBe(
      'pass',
    );
    expect(evaluateArchetype(page(['page-shell'], 'form', false), 'form-settings').missing).toEqual(
      ['section-shell | page-shell + form'],
    );
    expect(
      evaluateArchetype(page(['page-shell', 'page-header'], 'collection'), 'dashboard').missing,
    ).toEqual([
      'page-shell[data-archetype="dashboard"] (rendered "collection")',
      'editable-grid | kpi-grid',
    ]);
    expect(evaluateArchetype(page([], null), 'collection').missing?.[0]).toBe(
      'page-shell[data-archetype="collection"]',
    );
    expect(evaluateArchetype(page([], null), 'public-auth').verdict).toBe('n/a');
  });

  it('allow-list entries turn a fail into allow-listed with the entry reason, never a pass', () => {
    const allowlist: ConformanceAllowlistEntry[] = [
      {
        page: '/stock/items',
        rule: 'archetype',
        class: null,
        reason: 'owns its header',
        reverifiedAt: null,
      },
    ];
    const failing = { ...clean, landmarks: ['page-shell'] };
    const evidence = evaluateConformance(failing, collection, noEvents, allowlist);
    expect(evidence.archetype).toMatchObject({
      verdict: 'allow-listed',
      reason: 'owns its header',
    });
    expect(evidence.archetype.missing).toContain('page-header');
    expect(evaluateConformance(clean, collection, noEvents, allowlist).archetype.verdict).toBe(
      'pass',
    );
    expect(
      evaluateConformance(failing, { ...collection, pattern: '/other' }, noEvents, allowlist)
        .archetype.verdict,
    ).toBe('fail');
  });

  it('blocked carries the reason on every rule', () => {
    const blocked = blockedConformance('fixture missing');
    expect(Object.values(blocked)).toEqual(
      Array(6).fill({ verdict: 'blocked', reason: 'fixture missing' }),
    );
  });
});

describe('runtime diagnostics snapshot (happy-dom)', () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
    document.body.innerHTML = '';
    document.body.removeAttribute('data-allow-document-overflow');
  });
  /** happy-dom has no layout: size comes from `data-w`/`data-h` on the fixture. */
  const layoutFromAttributes = () => {
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const width = Number(this.getAttribute('data-w') ?? 48);
      const height = Number(this.getAttribute('data-h') ?? 48);
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({}),
      };
    };
  };

  it('excludes controls inside [data-dense] and names the region by its owner', () => {
    layoutFromAttributes();
    document.body.innerHTML = `
      <div data-part="page-shell" data-archetype="collection">
        <header data-part="page-header" data-component="page-header">
          <h1>Items</h1>
          <div data-part="primary-actions">
            <button data-variant="primary" id="new">New</button>
            <button data-variant="primary" id="import">Import</button>
            <button data-variant="outline" id="export">Export</button>
          </div>
        </header>
        <div data-component="data-table">
          <div class="dt-view-tools" data-dense><button data-w="20" data-h="20" aria-label="a">a</button></div>
          <div data-part="body" data-dense><button data-w="20" data-h="20" aria-label="b">b</button></div>
        </div>
        <button id="loose" data-w="30" data-h="30">loose</button>
      </div>`;
    const snapshot = runtimeUiDiagnosticsInBrowser({ minimumInteractiveTargetPx: 44 });
    expect(snapshot.undersizedInteractiveElements).toEqual(['#loose']);
    expect(snapshot.denseRegions).toEqual(['body', 'data-table']);
    expect(snapshot.pageShellArchetype).toBe('collection');
    expect(snapshot.landmarks).toEqual([
      'body',
      'data-table',
      'page-header',
      'page-shell',
      'primary-actions',
    ]);
    expect(snapshot.primaryHeaderActions).toEqual(['#new', '#import']);
    expect(snapshot.visibleRouteTitles).toEqual(['Items']);
    expect(snapshot.formRendered).toBe(false);
  });

  it('reads the overflow declaration from the page shell as well as body', () => {
    layoutFromAttributes();
    document.body.innerHTML =
      '<div data-part="page-shell" data-archetype="canvas" data-allow-document-overflow="true"></div>';
    expect(runtimeUiDiagnosticsInBrowser({}).documentOverflowAllowed).toBe(true);
    document.body.innerHTML = '<div data-part="page-shell" data-archetype="canvas"></div>';
    expect(runtimeUiDiagnosticsInBrowser({}).documentOverflowAllowed).toBe(false);
  });
});
