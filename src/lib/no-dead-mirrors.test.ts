import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Guards against the reintroduction of "dead mirror" files: local copies of
// types/schema that a canonical @minion-stack/* package already exports.
// See specs/2026-08-17-hub-dead-mirrors-cleanup-spec.md.
//
// The searched-for path is built from segments (not spelled out as one
// literal) so this file itself doesn't trip its own grep-level DoD check.
const DELETED_MIRROR_PATH = ['lib', 'types', 'secrets'].join('/');

const SRC_ROOT = join(process.cwd(), 'src');

function walkFiles(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

function filesReferencing(needle: string): string[] {
  return walkFiles(SRC_ROOT).filter((path) => readFileSync(path, 'utf8').includes(needle));
}

describe('dead mirror guard: deleted secrets type mirror', () => {
  test('the mirror file does not exist', () => {
    expect(existsSync(join(SRC_ROOT, ...DELETED_MIRROR_PATH.split('/')) + '.ts')).toBe(false);
  });

  test('no source file imports from the deleted mirror path', () => {
    expect(filesReferencing(DELETED_MIRROR_PATH)).toEqual([]);
  });
});
