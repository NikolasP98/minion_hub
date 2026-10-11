/**
 * Guard against the adapter-vercel function split (prod incidents 2026-07-16
 * and 2026-10-11): a per-route `export const config = { … }` in any route
 * module makes adapter-vercel build that route as its OWN function, and every
 * locale-prefixed URL (/en/*, /es/*) then falls to the empty `[-]/catchall`
 * function and 404s — the login page becomes unreachable for logged-out
 * users while canonical paths keep working, so nobody logged in notices.
 *
 * Per-function limits live ONLY in svelte.config.js (`adapter({ maxDuration })`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE_MODULE = /^\+(server|page|page\.server|layout|layout\.server)\.(ts|js)$/;
const CONFIG_EXPORT = /^\s*export\s+const\s+config\b/m;

function routeModules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeModules(full, out);
    else if (ROUTE_MODULE.test(entry)) out.push(full);
  }
  return out;
}

describe('no route module exports a per-route Vercel `config`', () => {
  const routesDir = dirname(fileURLToPath(import.meta.url));
  const files = routeModules(routesDir);

  it('found route modules (guards against a silently-empty sweep)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every route module is free of `export const config`', () => {
    const offenders = files
      .filter((file) => CONFIG_EXPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(routesDir, file));
    expect(offenders, 'move the limit to svelte.config.js adapter({ maxDuration })').toEqual([]);
  });
});
