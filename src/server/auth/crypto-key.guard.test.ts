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
 *
 * Changed vs. the first attempt of this run, which had guards that failed on
 * their own subject matter the moment it was committed:
 *
 *  1. The scan set is now *shipped* sources only. `git ls-files` does not list
 *     untracked files, so scanning `**\/*.test.ts` looked green locally (the new
 *     tests were still untracked) and went red in CI, flagging the very tests
 *     that assert the refusal message never echoes the dev-key literal. A test
 *     file seals nothing at rest; naming the literal in an assertion is the
 *     opposite of reintroducing it.
 *  2. Counting boot-assertion call sites now strips the function's own
 *     declaration first. `export function assertCryptoKeyConfigured(): void`
 *     contains the same characters as a call, so the declaration in
 *     `crypto-key.ts` was being counted as a second call site.
 *
 * Both narrowings are themselves tested below ("the matchers have teeth"), on
 * synthetic snippets, so the guards cannot be quietly widened into no-ops.
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

/** Hardcoded key material from `@minion-stack/db/crypto`, in code (not prose). */
function embedsKeyMaterial(code: string): boolean {
  return code.includes('minion-hub-dev-key') || code.includes('minion-hub-salt');
}

/** A second key-derivation site: the hub must never call scrypt itself. */
function derivesKey(code: string): boolean {
  return /\bscryptSync\b|\bscrypt\(/.test(code);
}

/**
 * Calls to the boot assertion, excluding the function's own declaration —
 * `export function assertCryptoKeyConfigured(): void` is not a call site.
 */
function countBootAssertionCalls(code: string): number {
  const withoutDeclaration = code.replace(
    /\bfunction\s+assertCryptoKeyConfigured\s*\(/g,
    'function declaredHere(',
  );
  return (withoutDeclaration.match(/\bassertCryptoKeyConfigured\s*\(\s*\)/g) ?? []).length;
}

/**
 * Shipped sources: everything the server actually runs. Test files are excluded
 * on purpose — see the header note (1). The exclusion is bounded by the coverage
 * assertions below, which pin the files that must always be in this set.
 */
const shippedSources = trackedFiles('src').filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
);

describe('the matchers have teeth', () => {
  it('flags hardcoded key material, including inside a rename or a template', () => {
    expect(
      embedsKeyMaterial(`const k = scryptSync('minion-hub-dev-key', 'minion-hub-salt', 32);`),
    ).toBe(true);
    expect(embedsKeyMaterial(`const salt = \`minion-hub-salt\`;`)).toBe(true);
    expect(embedsKeyMaterial(`const k = process.env.ENCRYPTION_KEY;`)).toBe(false);
  });

  it('flags a second derivation site whichever scrypt form is used', () => {
    expect(derivesKey(`import { scryptSync } from 'node:crypto';`)).toBe(true);
    expect(derivesKey(`scrypt(pass, salt, 32, cb);`)).toBe(true);
    expect(derivesKey(`const mode = cryptoKeyMode();`)).toBe(false);
  });

  it('counts calls to the boot assertion but not its declaration', () => {
    expect(countBootAssertionCalls(`export function assertCryptoKeyConfigured(): void {}`)).toBe(0);
    expect(countBootAssertionCalls(`if (!building) assertCryptoKeyConfigured();`)).toBe(1);
    expect(
      countBootAssertionCalls(
        `export function assertCryptoKeyConfigured(): void {}\nassertCryptoKeyConfigured();`,
      ),
    ).toBe(1);
    expect(countBootAssertionCalls(`import { assertCryptoKeyConfigured } from './crypto';`)).toBe(
      0,
    );
  });
});

describe('no second key-derivation path in the hub', () => {
  it('scans the shipped sources, including the crypto modules themselves', () => {
    expect(shippedSources.length).toBeGreaterThan(100);
    // If these ever drop out of the scan set (rename, move, deletion), the
    // guards below would pass vacuously for the files that matter most.
    expect(shippedSources).toContain('src/server/auth/crypto.ts');
    expect(shippedSources).toContain('src/server/auth/crypto-key.ts');
    expect(shippedSources).toContain('src/hooks.server.ts');
  });

  it('never hardcodes the development key or its salt', () => {
    const offenders = shippedSources.filter((f) => embedsKeyMaterial(readCode(f)));
    expect(
      offenders,
      'Key material belongs to @minion-stack/db/crypto only. Use cryptoKeyMode() from ' +
        '$server/auth/crypto to decide what this process may derive.',
    ).toEqual([]);
  });

  it('never derives its own key with scrypt', () => {
    const offenders = shippedSources.filter((f) => derivesKey(readCode(f)));
    expect(
      offenders,
      'The hub must not derive encryption keys. One derivation path lives in ' +
        '@minion-stack/db/crypto (R7 of 2026-05-26-auth-token-simplification).',
    ).toEqual([]);
  });
});

describe('boot assertion wiring', () => {
  it('calls assertCryptoKeyConfigured exactly once, in the server hooks', () => {
    const callSites = shippedSources.flatMap((f) =>
      Array.from({ length: countBootAssertionCalls(readCode(f)) }, () => f),
    );
    expect(
      callSites,
      'The boot assertion runs once, from src/hooks.server.ts. A second call site means a ' +
        'second boot path that can start without a key; zero means the hub fails open again.',
    ).toEqual(['src/hooks.server.ts']);
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
