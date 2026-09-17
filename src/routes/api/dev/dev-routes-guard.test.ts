import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Development-process contract (spec 2026-09-16-hub-minion-run-dev-switcher
 * §3): "/api/dev/* handlers must start with the 404 guard; a unit test
 * enumerates the directory and asserts every +server.ts imports
 * requireDevBackend." Walks the filesystem rather than a hand-maintained
 * list, so a new /api/dev/* route can't ship ungated.
 */
function findServerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...findServerFiles(full));
    } else if (entry === '+server.ts') {
      out.push(full);
    }
  }
  return out;
}

describe('every /api/dev/* handler is gated by requireDevBackend', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = findServerFiles(here);

  it('found at least one /api/dev/* +server.ts (guards against a silently-empty sweep)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f] as const))('%s imports requireDevBackend', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toMatch(/requireDevBackend/);
    expect(source).toMatch(/requireDevBackend\s*\(\s*locals\s*\)/);
  });
});
