import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const receiptBytes = readFileSync('deps/design-system-provenance.json');
const receipt = JSON.parse(receiptBytes.toString()) as {
  contractVersion: string;
  packages: Array<{
    name: string;
    artifact: string;
    version: string;
    sha256: string;
    members: Record<string, string>;
    sourceMembers: Record<string, string>;
    repacksByteIdentical: boolean;
  }>;
};
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
      // Bun >=1.4.4 drops an empty install marker into file: deps; it is not a package member.
      if (!prefix && entry.name === '.bun-tag') return [];
      const name = prefix + entry.name;
      if (entry.isDirectory())
        return Object.entries(installed(join(directory, entry.name), name + '/'));
      expect(entry.isFile(), name).toBe(true);
      return [[name, sha(readFileSync(join(directory, entry.name)))]];
    }),
  );
}
function verifyConsumer(manifest: string, lock: string, name: string, artifact: string) {
  const target = 'deps/' + artifact;
  expect(JSON.parse(manifest).dependencies[name]).toBe('file:' + target);
  const refs = lock
    .split('\n')
    .filter((line) => line.trim().startsWith(JSON.stringify(name) + ':'));
  expect(refs).toHaveLength(2);
  expect(refs[0]).toContain('"file:' + target + '"');
  expect(refs[1]).toContain('"' + name + '@' + target + '"');
}
describe('canonical immutable design-system artifacts', () => {
  it('pins the reviewed complete receipt', () => {
    expect(sha(receiptBytes)).toBe(
      'f53996517d83223776fb9fbb0cccf57fa9ed5459ca7ea33a8a85b426e6c98477',
    );
    expect(receipt.contractVersion).toBe('1.1.0');
    expect(receipt.packages.map((p) => p.name).sort()).toEqual([
      '@minion-stack/design-tokens',
      '@minion-stack/ui',
    ]);
  });
  for (const item of receipt.packages) {
    it(item.name + ' matches every archived and installed member', () => {
      expect(item.repacksByteIdentical).toBe(true);
      expect(sha(readFileSync('deps/' + item.artifact))).toBe(item.sha256);
      const members = archive('deps/' + item.artifact);
      expect(members).toEqual(item.members);
      expect(installed('node_modules/' + item.name)).toEqual(members);
      expect(
        JSON.parse(readFileSync('node_modules/' + item.name + '/package.json', 'utf8')).version,
      ).toBe(item.version);
      verifyConsumer(
        readFileSync('package.json', 'utf8'),
        readFileSync('bun.lock', 'utf8'),
        item.name,
        item.artifact,
      );
      for (const [name, digest] of Object.entries(item.sourceMembers))
        if (name !== 'package.json') expect(members[name], name).toBe(digest);
    });
    it.each(['missing member', 'extra member', 'changed runtime', 'changed declaration'])(
      'rejects ' + item.name + ' %s',
      (fault) => {
        const changed = { ...item.members };
        const runtime = Object.keys(changed).find(
          (name) => name.endsWith('.svelte') || name === 'tokens.css',
        )!;
        const declaration = Object.keys(changed).find(
          (name) => name.endsWith('.d.ts') || name === 'contract.json',
        )!;
        if (fault === 'missing member') delete changed[runtime];
        if (fault === 'extra member') changed['Unexpected.js'] = 'unexpected';
        if (fault === 'changed runtime') changed[runtime] = 'changed';
        if (fault === 'changed declaration') changed[declaration] = 'changed';
        expect(() => expect(changed).toEqual(item.members)).toThrow();
      },
    );
    it.each(['manifest', 'lock workspace', 'lock resolution'])(
      'rejects ' + item.name + ' stale %s',
      (fault) => {
        let manifest = readFileSync('package.json', 'utf8'),
          lock = readFileSync('bun.lock', 'utf8');
        const target = 'deps/' + item.artifact;
        if (fault === 'manifest')
          manifest = manifest.replace('file:' + target, 'file:deps/old.tgz');
        if (fault === 'lock workspace') lock = lock.replace('file:' + target, 'file:deps/old.tgz');
        if (fault === 'lock resolution')
          lock = lock.replace(item.name + '@' + target, item.name + '@deps/old.tgz');
        expect(() => verifyConsumer(manifest, lock, item.name, item.artifact)).toThrow();
      },
    );
  }
});
