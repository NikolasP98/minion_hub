import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Stacking-order governance (owner report 2026-09-22: the calendar's sticky
 * gutter painted over the sidebar and its tooltips).
 *
 * The layer ladder in `packages/design-tokens/contract.json` is a contract about
 * the WHOLE app: sticky(10) < navigation(20) < dropdown(30) < popover(40) <
 * modal(50) < toast(60) < command(70). Two habits break it:
 *
 *  1. In-page sticky chrome (a table header, a calendar gutter, a pane header)
 *     claiming a FLOATING layer to win a purely local contest. It then also
 *     outranks the sidebar and every real menu, and the next component has to
 *     claim something higher still — an arms race whose end state is z-index
 *     9999 everywhere.
 *  2. A raw numeric z-index, which is outside the ladder by construction.
 *
 * Local ordering is fine — it just has to be LOCAL: give the container
 * `isolation: isolate` and order the tiers inside it (see `.cal-scroll` in
 * BookingCalendar and `.catalog` in pos/sell).
 */

const SRC = join(process.cwd(), 'src');
const FLOATING = ['dropdown', 'popover', 'modal', 'toast', 'command', 'debug'];

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) svelteFiles(p, out);
    else if (entry.endsWith('.svelte')) out.push(p);
  }
  return out;
}

/** CSS rule blocks inside a component's <style> block. */
function styleRules(src: string): { selector: string; body: string }[] {
  const at = src.indexOf('<style');
  if (at === -1) return [];
  const style = src.slice(at);
  return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').pop()!.trim(),
    body: m[2],
  }));
}

describe('z-index layer governance', () => {
  const files = svelteFiles(SRC);

  it('no in-page sticky element claims a floating layer', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(SRC.length + 1);
      for (const { selector, body } of styleRules(src)) {
        const pos = /position:\s*sticky/.exec(body);
        const layer = /z-index:\s*var\(--layer-(\w+)/.exec(body);
        if (pos && layer && FLOATING.includes(layer[1])) {
          offenders.push(`${rel} ${selector} -> --layer-${layer[1]}`);
        }
      }
      // Same rule for the Tailwind spelling on a single element.
      for (const m of src.matchAll(/class="[^"]*\bsticky\b[^"]*z-\[var\(--layer-(\w+)\)/g)) {
        if (FLOATING.includes(m[1])) offenders.push(`${rel} (tailwind sticky) -> --layer-${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no raw numeric z-index outside self-contained card/preview art', () => {
    // These draw layered artwork inside one card and never interact with app
    // chrome; their numbers are local by construction.
    const ART = ['components/marketplace/', 'components/settings/CRTConfigModal.svelte'];
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(SRC.length + 1);
      if (ART.some((a) => rel.includes(a))) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/z-index:\s*(-?\d+)/g)) {
        if (Number(m[1]) !== 0) offenders.push(`${rel} z-index: ${m[1]}`);
      }
      for (const m of src.matchAll(/!?z-\[(\d+)\]/g)) {
        if (Number(m[1]) > 1) offenders.push(`${rel} z-[${m[1]}]`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every floating primitive portals out of its host stacking context', () => {
    // A panel rendered inline is capped by the nearest ancestor that creates a
    // stacking context — no z-index on the panel can lift it out. Dropdown,
    // Tooltip and Popover portal to <body> (Popover joined 2026-09-25: inline,
    // its /pos/sell panels painted under a sibling column's `relative` buttons
    // and under the sidebar). Combobox is still inline and tracked in the
    // follow-up proposal.
    for (const name of ['Dropdown', 'Tooltip', 'Popover']) {
      const src = readFileSync(join(SRC, 'lib/components/ui', `${name}.svelte`), 'utf8');
      expect(src, `${name} must portal`).toMatch(/use:portal/);
      expect(src, `${name} must set a layer token`).toMatch(/var\(--layer-\w+\)/);
    }
  });
});
