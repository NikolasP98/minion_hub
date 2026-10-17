// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import SectionNav from './SectionNav.svelte';

const items = [
  { id: 'overview', label: 'Stock', href: '/stock' },
  { id: 'items', label: 'Items', href: '/stock/items' },
  { id: 'entries', label: 'Entries', href: '/stock/entries' },
];
const collapse = { href: '/stock', label: 'Stock' };

afterEach(cleanup);

describe('SectionNav collapse (index sidebar → parent route, spec 013)', () => {
  it('on a child page marks itself collapsed and offers one back row to the parent', () => {
    const r = render(SectionNav, { items, activeId: 'items', ariaLabel: 'Stock', collapse });
    const aside = r.container.querySelector('[data-component="section-nav"]')!;
    expect(aside.getAttribute('data-collapsed')).toBe('true');
    const back = r.container.querySelector<HTMLAnchorElement>('a.nav-collapse')!;
    expect(back.getAttribute('href')).toBe('/stock');
    expect(back.textContent).toContain(m.nav_back_to_section({ section: 'Stock' }));
    expect(back.textContent).toContain('Items');
    // The index itself is still in the DOM: CSS hides it only below 768px.
    expect(r.container.querySelectorAll('nav a')).toHaveLength(3);
  });

  it('on the parent page keeps the full index and no back row', () => {
    const r = render(SectionNav, { items, activeId: 'overview', ariaLabel: 'Stock', collapse });
    const aside = r.container.querySelector('[data-component="section-nav"]')!;
    expect(aside.hasAttribute('data-collapsed')).toBe(false);
    expect(r.container.querySelector('a.nav-collapse')).toBeNull();
  });

  it('without `collapse` behaves as before', () => {
    const r = render(SectionNav, { items, activeId: 'items', ariaLabel: 'Stock' });
    expect(r.container.querySelector('[data-collapsed]')).toBeNull();
    expect(r.container.querySelector('a.nav-collapse')).toBeNull();
  });

  it('hides the strip and shows the back row only under the 767.98px breakpoint', () => {
    // happy-dom has no layout engine; the breakpoint rule is asserted at the source.
    const css = readFileSync('src/lib/components/ui/foundations/SectionNav.svelte', 'utf8');
    const narrow = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    expect(narrow).toMatch(
      /\[data-collapsed='true'\] nav,\s*\[data-collapsed='true'\] \.nav-search \{\s*display: none;/,
    );
    expect(narrow).toMatch(/\.nav-collapse \{\s*display: flex;/);
    expect(css).toMatch(/\.nav-collapse \{\s*display: none;\s*\}/);
  });
});
