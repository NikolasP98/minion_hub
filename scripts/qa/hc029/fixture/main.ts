import './fixture.css';
import { mount } from 'svelte';
import DateRangeControls from '../../../../src/lib/components/dashboard/DateRangeControls.svelte';
import { applyTheme } from '../../../../src/lib/themes/runtime';
import { PRESETS, ACCENT_OPTIONS } from '../../../../src/lib/themes/presets';

const MIN = 44; // --control-height-touch (packages/design-tokens/contract.json)
const changes: unknown[] = [];

mount(DateRangeControls, {
  target: document.getElementById('mount')!,
  props: {
    from: '2026-09-01',
    to: '2026-09-30',
    period: 'day',
    timeZone: 'UTC',
    onChange: (v: unknown) => changes.push(v),
  },
});

const describe = (el: HTMLElement) =>
  el.getAttribute('aria-label') ||
  el.getAttribute('title') ||
  el.textContent?.trim() ||
  `${el.tagName.toLowerCase()}[type=${el.getAttribute('type')}]`;

/** Bounding box of every visible interactive target in the controls (+ the open menu). */
export function measure() {
  const host = document.getElementById('mount')!;
  const nodes = Array.from(host.querySelectorAll<HTMLElement>('button, input, [role^="menuitem"]'));
  const coarse = matchMedia('(pointer: coarse)').matches;
  return nodes
    .filter((el) => !el.hidden && !el.closest('[hidden]'))
    .map((el) => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width * 100) / 100;
      const h = Math.round(r.height * 100) / 100;
      return {
        target: describe(el),
        role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
        x: Math.round(r.x),
        y: Math.round(r.y),
        w,
        h,
        ok: w >= MIN && h >= MIN,
        inViewport: r.right <= innerWidth && r.left >= 0,
      };
    })
    .concat([
      {
        target: '__env',
        role: `pointer:${coarse ? 'coarse' : 'fine'} ${innerWidth}x${innerHeight}`,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        ok: true,
        inViewport: true,
      },
    ]);
}

export function focusState() {
  const a = document.activeElement as HTMLElement | null;
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  const activeId = menu?.getAttribute('aria-activedescendant');
  const item = activeId ? document.getElementById(activeId) : null;
  return {
    menuOpen: !!menu && !menu.hidden,
    activeElement: a ? `${a.tagName.toLowerCase()}#${a.id || ''}[${describe(a)}]` : null,
    activeItem: item
      ? `${item.getAttribute('role')}[${describe(item)}] checked=${item.getAttribute('aria-checked')}`
      : null,
    changes: changes.length,
  };
}

export function setTheme(presetId: string, accentId: string) {
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const accent = ACCENT_OPTIONS.find((a) => a.id === accentId)!;
  applyTheme(preset, accent.value);
}

Object.assign(window, { __hc029: { measure, focusState, setTheme } });
setTheme('new-york', 'blue');
