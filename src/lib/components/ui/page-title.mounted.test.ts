// @vitest-environment happy-dom
/**
 * Spec 151 (a11y program S2): every page gets a browser title, a page that sets its own
 * keeps it, and the signed-in shell's <main> is the only one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_NAV_CONFIG } from '$lib/nav/custom-sections';

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return state.data;
    },
    get url() {
      return new URL('http://localhost/en/settings/developers');
    },
  },
}));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn() }));
import Fixture from './page-title.fixture.svelte';

beforeEach(() => {
  document.title = '';
  state.data = { navConfig: EMPTY_NAV_CONFIG, permissions: { permissions: [] } };
});
afterEach(cleanup);

describe('browser title (spec 151)', () => {
  it('a header gives the page "<title> · <hub name>"', () => {
    render(Fixture);
    expect(document.title).toBe('Developers · MINION Hub');
  });

  it('carries the organisation’s own hub name', () => {
    state.data = {
      ...state.data,
      branding: {
        orgId: 'o',
        name: 'Faces',
        fullName: 'Faces Hub',
        source: 'custom',
        readStatus: 'ready',
      },
    };
    render(Fixture);
    expect(document.title).toBe('Developers · Faces Hub');
  });

  it('a page that sets its own title keeps it', () => {
    render(Fixture, { props: { own: true } });
    expect(document.title).toBe('Ana Díaz — CRM');
  });

  // The deepest <title> wins in Svelte, so a header would silently replace a page's own
  // title. Any file that has both must opt the header out.
  it('every file with its own <title> opts its PageHeader out', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.svelte') && !/stories|fixture|harness/.test(path))
          files.push(path);
      }
    };
    walk('src');
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      if (!/<title/.test(source)) return false;
      const headers = source.match(/<PageHeader(?=[\s>])[^>]*/g) ?? [];
      return headers.some((tag) => !tag.includes('documentTitle={false}'));
    });
    expect(offenders).toEqual([]);
  });
});

describe('main landmark (spec 151)', () => {
  it('a standalone PageShell is the main landmark', () => {
    const view = render(Fixture);
    expect(view.container.querySelectorAll('main')).toHaveLength(1);
    expect(view.container.querySelector('main')?.dataset.component).toBe('page-shell');
  });

  it('inside the signed-in shell PageShell is a plain block, so <main> is never nested', () => {
    const view = render(Fixture, { props: { inShell: true } });
    expect(view.container.querySelector('main')).toBeNull();
    expect(view.container.querySelector('div[data-component="page-shell"]')).not.toBeNull();
  });

  it('the signed-in shell starts with the skip link and owns the one <main>', () => {
    const layout = readFileSync('src/routes/(app)/+layout.svelte', 'utf8');
    const markup = layout.slice(layout.indexOf('</script>'));
    const firstTag = /<(?!\/|!--|QueryClientProvider)([A-Za-z][\w:.]*)([^>]*)>/.exec(markup)!;
    expect(firstTag[1]).toBe('a');
    expect(firstTag[2]).toContain('href="#main-content"');
    expect(markup.match(/<main[\s>]/g)).toHaveLength(1);
    expect(markup).toContain('<main id="main-content" tabindex="-1"');
    expect(layout).toContain('setContext(MAIN_LANDMARK, true)');
    // No signed-in page renders a <main> of its own any more.
    const nested: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.svelte') && path !== 'src/routes/(app)/+layout.svelte') {
          if (/<main[\s>]/.test(readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '')))
            nested.push(path);
        }
      }
    };
    walk('src/routes/(app)');
    expect(nested).toEqual([]);
  });

  it('both primary navigation landmarks are named', () => {
    for (const file of [
      'src/lib/components/layout/Sidebar.svelte',
      'src/lib/components/layout/Topbar.svelte',
    ]) {
      const source = readFileSync(file, 'utf8');
      const nav = /<nav\s+data-part="navigation"[^>]*>/.exec(source)![0];
      expect(nav, file).toContain('aria-label={m.nav_primaryAria()}');
    }
  });
});
