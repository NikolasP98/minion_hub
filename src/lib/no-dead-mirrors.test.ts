/**
 * Guard for 2026-08-17-hub-dead-mirrors-cleanup-spec: the two retired local
 * mirrors must never come back, and nothing may import them. Canonical
 * sources: `@minion-stack/shared` (gateway/secrets) and
 * `@minion-stack/db/schema` (workspace_membership).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(import.meta.dirname, '..');
const SELF = join(import.meta.dirname, 'no-dead-mirrors.test.ts');

const DEAD_MIRRORS = [
  { file: 'lib/types/secrets.ts', importPattern: 'lib/types/secrets' },
  {
    file: 'server/db/schema/workspace-membership.ts',
    importPattern: 'db/schema/workspace-membership',
  },
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'paraglide') continue; // generated i18n output — thousands of files
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|js|svelte)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('no dead mirrors', () => {
  it.each(DEAD_MIRRORS)('$file does not exist', ({ file }) => {
    expect(existsSync(join(SRC_ROOT, file))).toBe(false);
  });

  it('no file under src/ references a retired mirror path', () => {
    const files = walk(SRC_ROOT).filter((f) => f !== SELF);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const { importPattern } of DEAD_MIRRORS) {
        if (content.includes(importPattern)) offenders.push(`${file} → ${importPattern}`);
      }
    }
    expect(offenders, 'retired-mirror references (import canonical @minion-stack pkg)').toEqual(
      [],
    );
  });
});
