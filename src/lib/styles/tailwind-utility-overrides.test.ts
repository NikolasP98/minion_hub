import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Scoped CSS must not key off a Tailwind RESPONSIVE-VISIBILITY utility.
 *
 * `hidden` never arrives alone: the sidebar writes `hidden md:inline`, meaning
 * "hidden on phones, shown from md up". A scoped rule like
 *
 *     .nav-text:global(.hidden) { display: none }
 *
 * carries the component's `.svelte-xxx` class, so its specificity (0,3,0) beats
 * BOTH halves — including the `md:inline` that is supposed to show the element.
 * Shipped 2026-09-22: it blanked every module label in the EXPANDED sidebar
 * while fixing the collapsed rail, because the fix was only ever checked in the
 * collapsed state.
 *
 * Key such rules off the component's own state instead (`aside.is-collapsed
 * .nav-text`), which says what you mean and cannot fight a breakpoint.
 */

const SRC = join(process.cwd(), 'src');
/** Utilities whose whole job is to be overridden at a breakpoint. */
const RESPONSIVE_VISIBILITY = ['hidden', 'inline', 'block', 'flex', 'grid', 'inline-flex'];

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) svelteFiles(p, out);
    else if (entry.endsWith('.svelte')) out.push(p);
  }
  return out;
}

describe('scoped CSS vs Tailwind utilities', () => {
  it('no scoped rule targets a responsive-visibility utility class', () => {
    const offenders: string[] = [];
    for (const file of svelteFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      const at = src.indexOf('<style');
      if (at === -1) continue;
      const style = src.slice(at);
      for (const m of style.matchAll(/:global\(\s*\.([a-z-]+)\s*\)/g)) {
        if (RESPONSIVE_VISIBILITY.includes(m[1])) {
          offenders.push(`${file.slice(SRC.length + 1)} :global(.${m[1]})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
