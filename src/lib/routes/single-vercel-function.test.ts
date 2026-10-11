import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The hub must deploy as ONE Vercel function. adapter-vercel splits the app
 * into a function per route the moment any `+server.ts`/`+page.server.ts`
 * exports its own `config` (runtime/maxDuration/isr…), and its generated
 * route table matches the RAW request path — before SvelteKit's locale
 * `reroute` strips `/en` or `/es` — so a prefixed page is routed to a
 * function whose manifest does not contain it and 404s. Production outage
 * 2026-10-11 (hub #479 added `export const config = { maxDuration: 60 }` to
 * one cron route; every `/en/login` and `/es/home` answered 404 for 11h).
 * Per-function limits belong in `svelte.config.js` adapter options.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/^\+(server|page\.server|layout\.server|page|layout)\.(ts|js)$/.test(name))
      out.push(p);
  }
  return out;
}

describe('deployment stays a single Vercel function', () => {
  it('no route file exports its own `config`', () => {
    const offenders = walk(join(process.cwd(), 'src/routes')).filter((f) =>
      /^\s*export\s+const\s+config\b/m.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
