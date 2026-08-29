/**
 * Guard for spec 2026-08-17-hub-dead-mirrors-cleanup-spec.
 *
 * The hub used to carry local *mirrors* of types that `@minion-stack/*` now
 * publishes. Each mirror carried a "delete me once the package ships it" TODO,
 * the package shipped it, and the mirror stayed — quietly free to drift away
 * from the wire contract it claims to describe.
 *
 * This guard makes the class un-reintroducible:
 *   1. the retired mirror files must not exist;
 *   2. no file under `src/` may reference their module specifiers;
 *   3. the canonical replacement must still carry the exact surface the hub
 *      depends on (a grep guard cannot see the package drifting).
 *
 * Slice 2 of the spec (`src/server/db/schema/workspace-membership.ts` →
 * `@minion-stack/db/schema`) extends `DEAD_MIRRORS` below rather than adding a
 * second guard file.
 * TODO(handoff): Slice 2 not yet implemented — add the
 * `server/db/schema/workspace-membership.ts` entry to DEAD_MIRRORS when it
 * lands. See specs/2026-08-17-hub-dead-mirrors-cleanup-spec.md §3.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRETS_METHODS } from '@minion-stack/shared';

/** `src/` — this file lives at `src/lib/no-dead-mirrors.test.ts`. */
const SRC_ROOT = join(import.meta.dirname, '..');
const SELF = join(import.meta.dirname, 'no-dead-mirrors.test.ts');

/** Retired mirrors: path under `src/`, and the specifier importers used. */
const DEAD_MIRRORS = [{ file: 'lib/types/secrets.ts', specifier: 'lib/types/secrets' }] as const;

/** Generated i18n output — thousands of files, none of them hand-written. */
const SKIP_DIRS = new Set(['paraglide']);

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkSource(join(dir, entry.name), out);
    } else if (/\.(ts|js|svelte)$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe('no dead mirrors', () => {
  it.each(DEAD_MIRRORS)('$file has been deleted', ({ file }) => {
    expect(existsSync(join(SRC_ROOT, file))).toBe(false);
  });

  it('no file under src/ references a retired mirror', () => {
    const offenders: string[] = [];
    for (const file of walkSource(SRC_ROOT)) {
      if (file === SELF) continue;
      const content = readFileSync(file, 'utf8');
      for (const { specifier } of DEAD_MIRRORS) {
        if (content.includes(specifier)) offenders.push(`${file} → ${specifier}`);
      }
    }
    expect(
      offenders,
      'these files still import a retired mirror; import the canonical @minion-stack package instead',
    ).toEqual([]);
  });

  // The greps above prove the mirror is gone. This proves the replacement is
  // real: SECRETS_METHODS is the hub's only wire-name table for the `secrets.*`
  // RPCs, and its camelCase keys deliberately differ from the snake_case wire
  // strings, so a silent rename in the package would break the Security tab
  // with no type error at all.
  it('@minion-stack/shared still exports the secrets wire-name table verbatim', () => {
    expect(SECRETS_METHODS).toEqual({
      list: 'secrets.list',
      set: 'secrets.set',
      clear: 'secrets.clear',
      probe: 'secrets.probe',
      setScoped: 'secrets.set_scoped',
      clearScoped: 'secrets.clear_scoped',
      probeScoped: 'secrets.probe_scoped',
    });
  });
});
