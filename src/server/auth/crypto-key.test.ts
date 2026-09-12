/**
 * Env matrix for the crypto-key boot policy
 * (specs/2026-08-17-pkg-dev-crypto-failopen-spec.md, S1's DoD table applied to
 * the hub's consumer-side assertion).
 *
 * Every case re-imports the module through `vi.resetModules()` because the
 * warn-once latch is module-level: a second case in the same file would
 * otherwise observe the first case's latch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CryptoKeyModule = typeof import('./crypto-key');

const CRYPTO_ENV_VARS = ['ENCRYPTION_KEY', 'MINION_ALLOW_DEV_CRYPTO_KEY', 'NODE_ENV'] as const;

let saved: Partial<Record<(typeof CRYPTO_ENV_VARS)[number], string | undefined>> = {};

/** Load a pristine copy of the module under an exact environment. */
async function loadWith(
  env: Partial<Record<(typeof CRYPTO_ENV_VARS)[number], string>>,
): Promise<CryptoKeyModule> {
  for (const name of CRYPTO_ENV_VARS) delete process.env[name];
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  vi.resetModules();
  return import('./crypto-key');
}

beforeEach(() => {
  saved = Object.fromEntries(CRYPTO_ENV_VARS.map((n) => [n, process.env[n]]));
});

afterEach(() => {
  for (const name of CRYPTO_ENV_VARS) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('cryptoKeyMode', () => {
  it('reports the configured mode when ENCRYPTION_KEY is set', async () => {
    const m = await loadWith({ ENCRYPTION_KEY: 'a-real-key' });
    expect(m.cryptoKeyMode()).toBe('configured');
  });

  it('prefers a configured key over the opt-in', async () => {
    const m = await loadWith({ ENCRYPTION_KEY: 'a-real-key', MINION_ALLOW_DEV_CRYPTO_KEY: '1' });
    expect(m.cryptoKeyMode()).toBe('configured');
  });

  it('throws when no key is set and the dev key was not opted into', async () => {
    const m = await loadWith({});
    expect(() => m.cryptoKeyMode()).toThrow(m.DEV_KEY_REFUSED_MESSAGE);
  });

  it('names both remedies and leaks no key material in the refusal', async () => {
    const m = await loadWith({});
    let message = '';
    try {
      m.cryptoKeyMode();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('ENCRYPTION_KEY');
    expect(message).toContain('MINION_ALLOW_DEV_CRYPTO_KEY=1');
    // The dev key literal lives in @minion-stack/db and must never be echoed.
    expect(message).not.toContain('minion-hub-dev-key');
    expect(message).not.toContain('minion-hub-salt');
  });

  it.each(['1', 'true', 'TRUE', 'True', ' 1 ', '  true  '])(
    'accepts the opt-in value %j',
    async (value) => {
      const m = await loadWith({ MINION_ALLOW_DEV_CRYPTO_KEY: value });
      expect(m.cryptoKeyMode()).toBe('dev-fallback');
    },
  );

  it.each(['0', 'false', 'FALSE', 'no', 'yes', 'off', '', '   ', '2', 'true1'])(
    'refuses the non-allowlisted opt-in value %j',
    async (value) => {
      const m = await loadWith({ MINION_ALLOW_DEV_CRYPTO_KEY: value });
      expect(() => m.cryptoKeyMode()).toThrow(m.DEV_KEY_REFUSED_MESSAGE);
    },
  );

  it('treats an empty ENCRYPTION_KEY as unset', async () => {
    const m = await loadWith({ ENCRYPTION_KEY: '' });
    expect(() => m.cryptoKeyMode()).toThrow(m.DEV_KEY_REFUSED_MESSAGE);
  });

  it('throws the unchanged production message when the key is missing in production', async () => {
    const m = await loadWith({ NODE_ENV: 'production' });
    expect(() => m.cryptoKeyMode()).toThrow(
      'ENCRYPTION_KEY environment variable must be set in production',
    );
  });

  it('refuses the opt-in in production, without even consulting it', async () => {
    const m = await loadWith({ NODE_ENV: 'production', MINION_ALLOW_DEV_CRYPTO_KEY: '1' });
    // The production message, NOT the dev-key refusal: an env var must never be
    // able to downgrade production crypto.
    expect(() => m.cryptoKeyMode()).toThrow(m.PRODUCTION_KEY_REQUIRED_MESSAGE);
    expect(() => m.cryptoKeyMode()).not.toThrow(m.DEV_KEY_REFUSED_MESSAGE);
  });

  it('lets a configured production key through', async () => {
    const m = await loadWith({ NODE_ENV: 'production', ENCRYPTION_KEY: 'a-real-key' });
    expect(m.cryptoKeyMode()).toBe('configured');
  });

  it('does not warn — it is the pure resolver', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await loadWith({ MINION_ALLOW_DEV_CRYPTO_KEY: '1' });
    m.cryptoKeyMode();
    m.cryptoKeyMode();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('assertCryptoKeyConfigured', () => {
  it('returns void when a key is configured, silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await loadWith({ ENCRYPTION_KEY: 'a-real-key' });
    expect(m.assertCryptoKeyConfigured()).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws the same refusal as cryptoKeyMode when nothing is configured', async () => {
    const m = await loadWith({});
    expect(() => m.assertCryptoKeyConfigured()).toThrow(m.DEV_KEY_REFUSED_MESSAGE);
  });

  it('throws the production message in production', async () => {
    const m = await loadWith({ NODE_ENV: 'production', MINION_ALLOW_DEV_CRYPTO_KEY: 'true' });
    expect(() => m.assertCryptoKeyConfigured()).toThrow(m.PRODUCTION_KEY_REQUIRED_MESSAGE);
  });

  it('warns exactly once per process on the dev-fallback path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await loadWith({ MINION_ALLOW_DEV_CRYPTO_KEY: '1' });
    m.assertCryptoKeyConfigured();
    m.assertCryptoKeyConfigured();
    m.assertCryptoKeyConfigured();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('MINION_ALLOW_DEV_CRYPTO_KEY');
    expect(line).not.toContain('minion-hub-dev-key');
  });
});

describe('re-export surface', () => {
  it('exposes the policy on $server/auth/crypto alongside the cipher helpers', async () => {
    process.env.ENCRYPTION_KEY = 'a-real-key';
    vi.resetModules();
    const m = await import('./crypto');
    expect(typeof m.assertCryptoKeyConfigured).toBe('function');
    expect(typeof m.cryptoKeyMode).toBe('function');
    expect(m.cryptoKeyMode()).toBe('configured');
    // The cipher helpers still come from the canonical package, unchanged.
    const sealed = m.encryptToken('hunter2');
    expect(m.decryptToken(sealed.encrypted, sealed.iv)).toBe('hunter2');
  });
});
