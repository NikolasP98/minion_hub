/**
 * Anti-recurrence guards for the crypto fail-open fix
 * (specs/2026-08-17-pkg-dev-crypto-failopen-spec.md, S2's guard applied to this
 * repo + S3's "called exactly once, server-side" DoD check).
 *
 * These are source-text assertions, deliberately. They cannot prove control-flow
 * reachability — `crypto-key.test.ts` is the executable proof of the policy —
 * but they do catch the two regressions that reintroduce the bug quietly: a
 * second key-derivation site appearing in the hub, and the boot assertion being
 * dropped or duplicated during a refactor.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** All tracked files under a directory, so untracked scratch files can't fail CI. */
function trackedFiles(dir: string): string[] {
  return execFileSync('git', ['ls-files', '--', dir], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

/**
 * Strip comments so the guards scan code, not prose. Doc comments legitimately
 * quote the key-derivation formula (`scryptSync(key, 'minion-hub-salt', 32)`)
 * to explain why the layout is frozen; flagging those would train people to
 * delete the explanation instead of the duplication.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      out += source[i++];
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') out += source[i++];
        out += source[i++];
      }
      out += source[i++] ?? '';
    } else {
      out += source[i++];
    }
  }
  return out;
}

/** File contents with comments removed. */
function readCode(relative: string): string {
  return stripComments(read(relative));
}

describe('no second key-derivation path in the hub', () => {
  const tsFiles = trackedFiles('src').filter((f) => f.endsWith('.ts'));

  it('has tracked TypeScript sources to scan', () => {
    expect(tsFiles.length).toBeGreaterThan(100);
  });

  it('never hardcodes the development key or its salt', () => {
    const offenders = tsFiles.filter((f) => {
      const src = readCode(f);
      return src.includes('minion-hub-dev-key') || src.includes('minion-hub-salt');
    });
    expect(
      offenders,
      'Key material belongs to @minion-stack/db/crypto only. Use cryptoKeyMode() from ' +
        '$server/auth/crypto to decide what this process may derive.',
    ).toEqual([]);
  });

  it('never derives its own key with scrypt', () => {
    const offenders = tsFiles.filter((f) => /\bscryptSync\b|\bscrypt\(/.test(readCode(f)));
    expect(
      offenders,
      'The hub must not derive encryption keys. One derivation path lives in ' +
        '@minion-stack/db/crypto (R7 of 2026-05-26-auth-token-simplification).',
    ).toEqual([]);
  });
});

describe('boot assertion wiring', () => {
  it('calls assertCryptoKeyConfigured exactly once, in the server hooks', () => {
    const callSites = trackedFiles('src')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .flatMap((f) => {
        const calls = readCode(f).match(/assertCryptoKeyConfigured\(\)/g) ?? [];
        return calls.map(() => f);
      });
    expect(callSites).toEqual(['src/hooks.server.ts']);
  });

  it('runs the assertion at module scope, not per request, and not during build', () => {
    const hooks = read('src/hooks.server.ts');
    expect(hooks).toContain('if (!building) assertCryptoKeyConfigured();');
  });

  it('runs after the env hoist so .env values are visible to the check', () => {
    const hooks = read('src/hooks.server.ts');
    expect(hooks.indexOf("import '$server/env-hoist';")).toBeGreaterThanOrEqual(0);
    expect(hooks.indexOf("import '$server/env-hoist';")).toBeLessThan(
      hooks.indexOf('assertCryptoKeyConfigured()'),
    );
  });
});

describe('.env.example documents the contract', () => {
  const envExample = read('.env.example');

  it('describes ENCRYPTION_KEY as required rather than optional-with-a-fallback', () => {
    expect(envExample).toContain('ENCRYPTION_KEY=');
    expect(envExample).not.toContain('Falls back to a deterministic dev key');
  });

  it('documents the opt-in as local-development-only', () => {
    const block = envExample.slice(
      envExample.indexOf('# LOCAL DEVELOPMENT ONLY'),
      envExample.indexOf('MINION_ALLOW_DEV_CRYPTO_KEY=') + 40,
    );
    expect(block).toContain('never set this in a deployed environment');
    expect(block).toContain('MINION_ALLOW_DEV_CRYPTO_KEY=');
  });

  it('ships no real ENCRYPTION_KEY value', () => {
    expect(envExample).toMatch(/^ENCRYPTION_KEY=$/m);
  });
});
