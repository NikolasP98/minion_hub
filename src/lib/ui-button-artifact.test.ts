import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const artifact = 'deps/minion-stack-ui-0.1.0-readiness.1.tgz';
const baseline = 'deps/minion-stack-ui-0.1.0-ui-coherence-6b21ce0e.tgz';
const receiptBytes = readFileSync('deps/ui-button-provenance.json');
const receipt = JSON.parse(receiptBytes.toString()) as {
  before: Record<string, string>;
  after: Record<string, string>;
  overlayFiles: string[];
  removedFiles: string[];
  sources: Record<string, string>;
  sha256: string;
  baselineSha256: string;
};
const changed = ['dist/Button.svelte', 'dist/Button.svelte.d.ts', 'package.json'];
function archive(file: string): Record<string, string> {
  const names = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((name) => !name.endsWith('/'));
  expect(new Set(names).size).toBe(names.length);
  expect(names.every((name) => name.startsWith('package/'))).toBe(true);
  return Object.fromEntries(
    names.map((name) => [name.slice(8), sha(execFileSync('tar', ['-xOzf', file, name]))]),
  );
}
function installed(directory: string, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const name = prefix + entry.name;
      if (entry.isDirectory())
        return Object.entries(installed(join(directory, entry.name), name + '/'));
      expect(entry.isFile(), name).toBe(true);
      return [[name, sha(readFileSync(join(directory, entry.name)))]];
    }),
  );
}
function verifyMembers(
  before: Record<string, string>,
  after: Record<string, string>,
  allowlist: string[],
) {
  expect(Object.keys(before)).toHaveLength(30);
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  expect([...allowlist].sort()).toEqual(changed);
  expect(
    Object.keys(before)
      .filter((name) => before[name] !== after[name])
      .sort(),
  ).toEqual(changed);
}
function verifyConsumer(manifest: string, lock: string) {
  expect(JSON.parse(manifest).dependencies['@minion-stack/ui']).toBe('file:' + artifact);
  // Bun locks local paths without content integrity; separately pin both its
  // workspace dependency and resolved package. The byte checks below own content.
  const references = lock
    .split('\n')
    .filter((line) => line.trim().startsWith('"@minion-stack/ui":'));
  expect(references).toHaveLength(2);
  expect(references[0]).toContain('"file:' + artifact + '"');
  expect(references[1]).toContain('"@minion-stack/ui@' + artifact + '"');
}

describe('reviewed Button-only UI artifact', () => {
  it('pins the receipt, archive, baseline and canonical source/declaration relationship', () => {
    expect(sha(receiptBytes)).toBe(
      'a95dcf74a78fb90f9fcd7d34b7747308818cf2020a185cf4ec55dd160d916c19',
    );
    expect(sha(readFileSync(artifact))).toBe(
      '403344ff7fd8116e51c011a29e71e40988ddf13595223cd9a443792f4f448249',
    );
    expect(sha(readFileSync(baseline))).toBe(
      '6b21ce0eb1ba09d840039ba8830171a380a15eb19a9f537c7e783bdb4f9b1dfc',
    );
    expect(receipt.sha256).toBe(sha(readFileSync(artifact)));
    expect(receipt.baselineSha256).toBe(sha(readFileSync(baseline)));
    expect(receipt.sources['packages/ui/src/lib/Button.svelte']).toBe(
      receipt.after['dist/Button.svelte'],
    );
    expect(receipt.sources['packages/ui/dist/Button.svelte.d.ts']).toBe(
      receipt.after['dist/Button.svelte.d.ts'],
    );
    expect(receipt.removedFiles).toEqual([]);
    verifyConsumer(readFileSync('package.json', 'utf8'), readFileSync('bun.lock', 'utf8'));
  });

  it('compares all 30 original, packed and installed members; other primitives cannot ride along', () => {
    const before = archive(baseline);
    const after = archive(artifact);
    expect(before).toEqual(receipt.before);
    expect(after).toEqual(receipt.after);
    verifyMembers(before, after, receipt.overlayFiles);
    expect(installed('node_modules/@minion-stack/ui')).toEqual(after);
    const oldPackage = JSON.parse(
      execFileSync('tar', ['-xOzf', baseline, 'package/package.json'], { encoding: 'utf8' }),
    );
    const newPackage = JSON.parse(
      readFileSync('node_modules/@minion-stack/ui/package.json', 'utf8'),
    );
    expect(newPackage).toEqual({ ...oldPackage, version: '0.1.0-readiness.1' });
  });

  it.each([
    'empty allowlist',
    'missing runtime',
    'extra member',
    'changed adjacent primitive',
    'stale declaration',
  ])('rejects %s independently of the receipt checksum', (fault) => {
    const after = { ...receipt.after };
    let allowlist = [...receipt.overlayFiles];
    if (fault === 'empty allowlist') allowlist = [];
    if (fault === 'missing runtime') delete after['dist/Button.svelte'];
    if (fault === 'extra member') after['dist/Unexpected.svelte'] = 'changed';
    if (fault === 'changed adjacent primitive') after['dist/Input.svelte'] = 'changed';
    if (fault === 'stale declaration')
      after['dist/Button.svelte.d.ts'] = receipt.before['dist/Button.svelte.d.ts'];
    expect(() => verifyMembers(receipt.before, after, allowlist)).toThrow();
  });

  it.each(['manifest', 'lock workspace', 'lock resolution'])(
    'rejects a stale %s reference',
    (fault) => {
      let manifest = readFileSync('package.json', 'utf8');
      let lock = readFileSync('bun.lock', 'utf8');
      if (fault === 'manifest') manifest = manifest.replace('file:' + artifact, 'file:' + baseline);
      if (fault === 'lock workspace') lock = lock.replace('file:' + artifact, 'file:' + baseline);
      if (fault === 'lock resolution')
        lock = lock.replace('@minion-stack/ui@' + artifact, '@minion-stack/ui@' + baseline);
      expect(() => verifyConsumer(manifest, lock)).toThrow();
    },
  );
});
