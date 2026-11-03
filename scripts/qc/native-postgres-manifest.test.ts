import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isOrdinaryVitestNativeExclusion,
  NATIVE_POSTGRES_LANES,
  NATIVE_POSTGRES_MANIFEST,
} from './native-postgres-manifest';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file.replaceAll('\\', '/')];
  });
}

export function validateNativePostgresOwnership(
  discovered: readonly string[],
  manifest: Record<
    string,
    readonly { file: string; requiredBehaviors: readonly string[]; minimumAssertions: number }[]
  >,
  present: (file: string) => boolean,
) {
  const ownership = new Map<string, string[]>();
  for (const [lane, admissions] of Object.entries(manifest)) {
    for (const admission of admissions) {
      ownership.set(admission.file, [...(ownership.get(admission.file) ?? []), lane]);
      if (!present(admission.file)) throw new Error(`Missing native fixture: ${admission.file}`);
      if (!isOrdinaryVitestNativeExclusion(admission.file)) {
        throw new Error(`Manifest contains a non-native fixture: ${admission.file}`);
      }
      if (admission.minimumAssertions < 1 || admission.requiredBehaviors.length < 1) {
        throw new Error(`Native admission lacks semantic evidence: ${admission.file}`);
      }
      if (admission.requiredBehaviors.length !== admission.minimumAssertions) {
        throw new Error(
          `Native admission does not name every ratcheted behavior: ${admission.file}`,
        );
      }
      if (new Set(admission.requiredBehaviors).size !== admission.requiredBehaviors.length) {
        throw new Error(`Native admission repeats a behavior: ${admission.file}`);
      }
    }
  }
  for (const [file, lanes] of ownership) {
    if (lanes.length !== 1) throw new Error(`Native fixture has duplicate ownership: ${file}`);
  }
  const expected = [...new Set(discovered)].sort();
  const admitted = [...ownership.keys()].sort();
  if (JSON.stringify(expected) !== JSON.stringify(admitted)) {
    const missing = expected.filter((file) => !ownership.has(file));
    const extra = admitted.filter((file) => !expected.includes(file));
    throw new Error(
      `Native ownership drift; missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`,
    );
  }
}

describe('native PostgreSQL ownership manifest', () => {
  it('matches every file excluded by the ordinary Vitest native policy exactly once', () => {
    const discovered = sourceFiles('src')
      .map((file) => path.relative(process.cwd(), file).replaceAll('\\', '/'))
      .filter(isOrdinaryVitestNativeExclusion);
    validateNativePostgresOwnership(discovered, NATIVE_POSTGRES_MANIFEST, existsSync);
    expect(discovered).toHaveLength(51);
    expect(NATIVE_POSTGRES_LANES).toHaveLength(9);
    const crmBulk = NATIVE_POSTGRES_MANIFEST['qa-native'].find(
      ({ file }) => file === 'src/server/services/crm-contact-tags-bulk.sql.integration.test.ts',
    );
    expect(crmBulk?.minimumAssertions).toBe(4);
    expect(crmBulk?.requiredBehaviors).toHaveLength(4);
  });

  it('excludes native fixtures from ordinary Vitest discovery', () => {
    const output = execFileSync(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'list', '--filesOnly', '--json'],
      {
        encoding: 'utf8',
        timeout: 20_000,
        env: Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !/^REQUIRE_[A-Z_]+_POSTGRES$/.test(key)),
        ),
      },
    );
    const selected = (JSON.parse(output) as { file: string }[]).map(({ file }) =>
      path.relative(process.cwd(), file).replaceAll('\\', '/'),
    );
    expect(selected).toContain('scripts/qc/native-postgres-manifest.test.ts');
    expect(selected.filter(isOrdinaryVitestNativeExclusion)).toEqual([]);
  }, 30_000);

  it('rejects omissions, duplicate ownership, missing files and non-native admissions', () => {
    const admission = { minimumAssertions: 1, requiredBehaviors: ['critical behavior'] };
    const discovered = ['src/a.sql.integration.test.ts'];
    expect(() => validateNativePostgresOwnership(discovered, {}, () => true)).toThrow('missing=');
    expect(() =>
      validateNativePostgresOwnership(
        discovered,
        {
          one: [{ file: discovered[0], ...admission }],
          two: [{ file: discovered[0], ...admission }],
        },
        () => true,
      ),
    ).toThrow('duplicate ownership');
    expect(() =>
      validateNativePostgresOwnership(
        discovered,
        { one: [{ file: discovered[0], ...admission }] },
        () => false,
      ),
    ).toThrow('Missing native fixture');
    expect(() =>
      validateNativePostgresOwnership(
        ['src/ordinary.test.ts'],
        { one: [{ file: 'src/ordinary.test.ts', ...admission }] },
        () => true,
      ),
    ).toThrow('non-native');
  });
});
