// @vitest-environment happy-dom
/**
 * UI-002 — the Team calendar toolbar on a compact / coarse-pointer viewport.
 *
 * Mounts the ACTUAL `/scheduling/calendar` route (presentation switcher, view
 * tabs, date navigation, options kebab, staff / kind / tag filters and the
 * "show linked tags" switch) with the mobile-composition seed, and proves the
 * two halves happy-dom can see:
 *   1. every toolbar control is one keyboard-reachable element (tab order =
 *      reading order, nothing disabled, each with an accessible name), and the
 *      switch's label is a sibling of the control rather than part of it;
 *   2. the compiled toolbar CSS carries the UI-002 layout contract: a
 *      `SegmentedControl` group is a FLOOR (`min-height`), not a fixed height
 *      its 44px buttons spill out of; the switch keeps its track and carries a
 *      44px hit box instead of being inflated to 44×44; route-mounted tools wrap.
 *
 * happy-dom lays nothing out, so the geometry itself (no intersecting boxes,
 * `scrollWidth <= clientWidth`, the 44px hit probe, one-line label) is asserted
 * in real Chromium by `tests/e2e/ui-audit/calendar-mobile.spec.ts`
 * ("Calendar toolbar targets remain usable …") on the same mounted route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import type { ComponentProps } from 'svelte';
import { page } from '$app/state';
import {
  EVENTS,
  EVENT_TYPES,
  FIXTURE_DAY,
  FIXTURE_TIME_ZONE,
  KINDS,
  RESOURCES,
  TAG_OPTIONS,
} from '../../../../tests/fixtures/mobile-composition/seed';
import { calendarWindowScope } from './calendar-window';

vi.mock('$app/state', async (original) => {
  const actual = await original<typeof import('$app/state')>();
  const { reactivePage } = await import('./__fixtures__/reactive-page.svelte');
  return { ...actual, page: reactivePage({ ...actual.page }) };
});
const { default: Calendar } =
  await import('../../../routes/(app)/scheduling/calendar/+page.svelte');

const calendarScope = calendarWindowScope('org-a', FIXTURE_TIME_ZONE);
const data = () =>
  ({
    view: 'week',
    pageView: 'week',
    day: FIXTURE_DAY,
    orgTz: FIXTURE_TIME_ZONE,
    calendarScope,
    staff: [],
    kindId: null,
    showInheritedTags: true,
    resources: RESOURCES,
    kinds: KINDS,
    eventTypes: EVENT_TYPES,
    categories: [],
    hours: {},
    tagOptions: TAG_OPTIONS,
    bookings: EVENTS,
  }) as unknown as ComponentProps<typeof Calendar>['data'];

beforeEach(() => {
  page.data = {
    activeOrgId: 'org-a',
    user: { id: 'user-a' },
    permissions: { permissions: ['scheduling:view', 'scheduling:create', 'scheduling:edit'] },
  };
  page.status = 200;
  page.error = null;
  // Week windows beyond the seed resolve empty; every other read is refused and
  // caught by its owner (custom columns fall back to none).
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('/api/scheduling/calendar')
        ? Response.json({ calendarScope, bookings: [], tagOptions: [] })
        : new Response(null, { status: 404 }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  page.data = {};
});

const name = (el: Element) =>
  (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');

describe('calendar toolbar controls', () => {
  it('are distinct, keyboard-reachable elements in reading order', () => {
    const view = render(Calendar, { data: data() });
    const toolbar = view.container.querySelector('.cal-toolbar')!;
    const controls = [...toolbar.querySelectorAll<HTMLElement>('button, select, [role="switch"]')];
    expect(controls.map(name)).toEqual([
      'Calendar',
      'Table',
      'Board',
      'Day',
      'Week',
      'Month',
      'Agenda',
      'Previous',
      expect.stringContaining('Sep'),
      'Next',
      'Today',
      'Calendar options',
      'Staff All staff',
      'Event type',
      'Tags',
      'Show linked tags',
    ]);
    for (const el of controls) {
      expect(el.tabIndex, name(el)).toBe(0);
      expect((el as HTMLButtonElement).disabled, name(el)).toBe(false);
      expect(name(el)).not.toBe('');
      // No control nests another: a nested target cannot be distinct.
      expect(el.querySelector('button, select, [role="switch"]')).toBeNull();
    }
    // The switch is the control; its visible label is a SIBLING, never crowded
    // inside the track, and the track reports its state to assistive tech.
    const sw = toolbar.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(sw.tagName).toBe('BUTTON');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    const wrap = sw.closest('[data-component="toggle-compat"]')!;
    expect(wrap.contains(sw)).toBe(true);
    expect(sw.textContent?.trim()).toBe('');
    expect(wrap.textContent).toContain('Show linked tags');
  });
});

/** Compiled scoped CSS of a component, whitespace-stripped for contract matching.
 *  `UI002_CSS_BASE_REF=<git ref>` compiles that ref's sources instead, which is
 *  how the pre-fix red run is reproduced (`HEAD` before the UI-002 commit). */
function css(path: string): string {
  const filename = fileURLToPath(new URL(path, import.meta.url));
  const ref = process.env.UI002_CSS_BASE_REF;
  const source = ref
    ? execFileSync('git', ['show', `${ref}:./${relative(process.cwd(), filename)}`], {
        encoding: 'utf8',
      })
    : readFileSync(filename, 'utf8');
  return compile(source, { filename, generate: 'client', css: 'external' }).css!.code.replace(
    /\s+/g,
    '',
  );
}
const declarations = (sheet: string, selector: RegExp) => {
  const match = sheet.match(new RegExp(`${selector.source}\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
};

describe('calendar toolbar compact layout contract (UI-002)', () => {
  it('SegmentedControl height is a floor its 44px members can raise', () => {
    const seg = css('../ui/SegmentedControl.svelte');
    expect(declarations(seg, /\.seg\.svelte-\w+/)).toContain('min-height:var(--control-height-sm)');
    expect(declarations(seg, /\.seg\.svelte-\w+/)).not.toMatch(/(^|;)height:/);
    expect(declarations(seg, /\.seg\.md\.svelte-\w+/)).not.toMatch(/(^|;)height:/);
  });

  it('the compact rule sizes buttons and selects, keeps the switch track and wraps the tools', () => {
    const sheet = css('./BookingCalendar.svelte');
    const compact = sheet.slice(sheet.indexOf('@media(max-width:767.98px),(pointer:coarse)'));
    expect(compact).toMatch(
      /button:not\(\[role='switch'\]\)[^{]*\{[^}]*min-height:var\(--control-height-touch\)/,
    );
    expect(declarations(compact, /\[role='switch'\]/)).not.toContain('min-');
    expect(compact).toMatch(
      /\[role='switch'\]::before\{[^}]*inset:min\(0px,calc\(\(var\(--control-height-touch\)-100%\)\/-2\)\)/,
    );
    expect(compact).toMatch(
      /\[data-component='toggle-compat'\]\{[^}]*min-height:var\(--control-height-touch\)/,
    );
    expect(declarations(compact, /\.cal-tools\.svelte-\w+/)).toContain('flex-wrap:wrap');
  });
});
