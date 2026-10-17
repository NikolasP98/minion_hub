import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Action scope + collapse-by-purpose on the pilots (spec 013, FR-006/FR-007).
 * Scope declarations are `data-action-scope` attributes on the region that
 * owns the action: `page` (PageHeader), `collection` (view toolbars),
 * `selection` (bulk bar), `row` (row/hover-card actions). The shared
 * components carry them, so every page that composes them inherits the
 * declaration; this test pins the shared markers and the pilots' headers.
 */
function routeSource(relativePath: string): string {
  return readFileSync(new URL(`../../routes/(app)/${relativePath}`, import.meta.url), 'utf8');
}
function componentSource(relativePath: string): string {
  return readFileSync(new URL(`../components/${relativePath}`, import.meta.url), 'utf8');
}
function primaryActionsSnippet(source: string): string {
  return /\{#snippet primaryActions\(\)\}([\s\S]*?)\{\/snippet\}/.exec(source)?.[1] ?? '';
}

const PILOTS = [
  'stock/+page.svelte',
  'stock/items/+page.svelte',
  'crm/+page.svelte',
  'crm/customers/+page.svelte',
  'scheduling/calendar/+page.svelte',
] as const;

describe('action scope on the pilots', () => {
  it.each(PILOTS)('%s header holds at most one primary action', (path) => {
    const snippet = primaryActionsSnippet(routeSource(path));
    expect((snippet.match(/<(Button|a)[\s>]/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it('shared regions declare the scope of the actions they own', () => {
    expect(componentSource('ui/PageHeader.svelte')).toContain('data-action-scope="page"');
    const table = componentSource('data-table/DataTable.svelte');
    expect(table).toMatch(/class="dt-toolbar view-toolbar" data-action-scope="collection"/);
    expect(table).toMatch(/class="dt-bulk-bar"[\s\S]{0,80}data-action-scope="selection"/);
    const calendar = componentSource('scheduling/BookingCalendar.svelte');
    expect(calendar).toContain('class="cal-toolbar" data-action-scope="collection"');
    expect(calendar).toContain('class="cal-tools" data-action-scope="collection"');
    expect(calendar).toContain('class="hc-actions" data-action-scope="row"');
    expect(routeSource('scheduling/calendar/+page.svelte')).toContain(
      'class="dv-bar view-toolbar" data-action-scope="collection"',
    );
  });
});

describe('collapse by purpose on the pilots', () => {
  it('index sidebar → parent route: the three section navs opt into SectionNav collapse', () => {
    for (const [file, href] of [
      ['stock/StockNav.svelte', '/stock'],
      ['crm/CrmNav.svelte', '/crm'],
      ['scheduling/SchedulingNav.svelte', '/scheduling'],
    ] as const) {
      expect(componentSource(file), file).toContain(`collapse={{ href: '${href}',`);
    }
  });

  it('filter bar → Sheet: the calendar mounts its filters through CollapsibleFilters in every view', () => {
    const page = routeSource('scheduling/calendar/+page.svelte');
    expect((page.match(/<CollapsibleFilters /g) ?? []).length).toBe(2);
    expect(page).toContain('activeCount={activeFilterCount}');
    expect(componentSource('data-table/CollapsibleFilters.svelte')).toContain(
      "matchMedia('(max-width: 767.98px)')",
    );
  });

  it('context panel → step: master-detail pilots show list OR detail below 768px', () => {
    const agents = routeSource('agents/+page.svelte');
    expect(agents).toMatch(
      /@media \(max-width: 767\.98px\) \{[\s\S]*\.wide-agent-workspace \{\s*display: none;/,
    );
    expect(agents).toContain('{#if ui.selectedAgentId}\n        <DetailPanel />');
    const sessions = routeSource('sessions/+page.svelte');
    expect(sessions).toMatch(/\[data-has-selection='true'\] \.sessions-master \{\s*display: none;/);
  });
});
