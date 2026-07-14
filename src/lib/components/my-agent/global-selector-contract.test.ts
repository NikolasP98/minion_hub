import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src/lib/components/my-agent');

function svelteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

describe('My Agent global selector contract', () => {
  it('uses one global wrapper for compound selectors', () => {
    const invalid: string[] = [];
    const chainedGlobal = /:global\([^)]*\):global\(/g;
    const locallyScopedCompound = /[.#][a-zA-Z0-9_-]+:global\(/g;

    for (const file of svelteFiles(root)) {
      const source = readFileSync(file, 'utf8');
      if (chainedGlobal.test(source) || locallyScopedCompound.test(source)) {
        invalid.push(relative(process.cwd(), file));
      }
      chainedGlobal.lastIndex = 0;
      locallyScopedCompound.lastIndex = 0;
    }

    expect(invalid).toEqual([]);
  });
});
