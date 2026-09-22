import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES = 'src/routes';
const APP = join(ROUTES, '(app)');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return svelteFiles(p);
    return e.name.endsWith('.svelte') ? [p] : [];
  });
}

/** Every template literal inside a `titleColumn={{ … }}` block, with `${…}` → `*`. */
function titleHrefs(source: string): string[] {
  const out: string[] = [];
  for (const block of source.matchAll(/titleColumn=\{\{([\s\S]*?)\}\}/g)) {
    for (const lit of block[1].matchAll(/`([^`]*)`/g)) {
      out.push(lit[1].replace(/\$\{[^}]*\}/g, '*'));
    }
  }
  return out;
}

/** Walk src/routes/(app) — literal segments match dirs, `*` matches a [param] dir. */
function routeExists(path: string): boolean {
  let dir = APP;
  for (const seg of path.split('/').filter(Boolean)) {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const hit =
      seg === '*'
        ? entries.find((n) => n.startsWith('[') && n.endsWith(']'))
        : entries.find((n) => n === seg);
    if (!hit) return false;
    dir = join(dir, hit);
  }
  try {
    return statSync(join(dir, '+page.svelte')).isFile();
  } catch {
    return false;
  }
}

describe('DataTable title links', () => {
  const links = svelteFiles(ROUTES)
    .concat(svelteFiles('src/lib'))
    .flatMap((file) => titleHrefs(readFileSync(file, 'utf8')).map((href) => ({ file, href })));

  it('finds the title links', () => {
    expect(links.length).toBeGreaterThanOrEqual(8);
  });

  it.each(links)('$href ($file) resolves to a real route', ({ href }) => {
    // Relative hrefs (?query=…) stay on the current page — nothing to resolve.
    if (!href.startsWith('/')) return;
    expect(routeExists(href), `no route renders ${href}`).toBe(true);
  });
});
