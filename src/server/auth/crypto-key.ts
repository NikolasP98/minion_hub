// Consumer-side crypto-key policy for the hub (S3 of
// specs/2026-08-17-pkg-dev-crypto-failopen-spec.md).
//
// The bug this closes: `@minion-stack/db`'s `key()` silently derives a
// hardcoded, source-visible key (`minion-hub-dev-key`, shipped in the public
// npm tarball) in *any* environment where `NODE_ENV !== 'production'`. A seal
// under that key succeeds, the matching open succeeds, and nothing in the stack
// ever notices — every secret written that way is plaintext-equivalent.
//
// This module is the hub's half of the fix: it resolves, at boot, which key
// this process is *entitled* to use, and throws when the answer is "the
// built-in dev key, and nobody said that was okay". `hooks.server.ts` calls
// `assertCryptoKeyConfigured()` once so a missing key is a named boot failure
// rather than a 500 on the first OAuth callback.
//
// It derives no key and holds no key material: no `scryptSync`, no dev-key
// literal, nothing logged. It only reads two environment variables. The
// key derivation itself stays in the one canonical place
// (`@minion-stack/db/crypto`) — R7 of
// specs/2026-05-26-auth-token-simplification.md.
//
// TODO(handoff): once the environment inventory, complete at-rest audit, and
// shared Hub/Site key decision are resolved, bump this repo's vendored
// `deps/minion-stack-db-*.tgz` to the published fail-closed 0.11.0 release, delete
// the policy below and re-export the package's own `cryptoKeyMode` /
// `assertCryptoKeyConfigured` instead. Until that bump lands, the package still
// fail-opens for any seal/open that does NOT go through the server boot path
// (scripts, cron entrypoints, `bun scripts/*.ts`); the boot assertion narrows
// the hole but does not close it. Pointer:
// docs/2026-08-17-hub-crypto-failopen-s3-rollout.md.

/** Which key this process is entitled to derive. */
export type CryptoKeyMode = 'configured' | 'dev-fallback';

/** Env var that must be set explicitly to accept the built-in development key. */
export const DEV_KEY_OPT_IN_VAR = 'MINION_ALLOW_DEV_CRYPTO_KEY';

/**
 * Production's error string, byte-identical to the one
 * `@minion-stack/db/crypto` has thrown since the guard was written — existing
 * log alerting may match on it, and the spec forbids changing production
 * behaviour in either direction.
 */
export const PRODUCTION_KEY_REQUIRED_MESSAGE =
  'ENCRYPTION_KEY environment variable must be set in production';

/**
 * The fail-closed message. Names both remedies and never echoes key material,
 * the dev-key literal, or any plaintext argument.
 */
export const DEV_KEY_REFUSED_MESSAGE =
  'ENCRYPTION_KEY is not set. Refusing to seal or open secrets with the built-in, ' +
  'source-visible development key. Set ENCRYPTION_KEY, or — for local development only — ' +
  `set ${DEV_KEY_OPT_IN_VAR}=1 to accept it.`;

/**
 * Strict allowlist, deliberately not truthiness: only `1` and `true` (trimmed,
 * case-insensitive) enable the opt-in. `MINION_ALLOW_DEV_CRYPTO_KEY=false`
 * evaluating to *enabled* is the same bug class this spec exists to remove.
 */
function devKeyOptIn(): boolean {
  const raw = (process.env[DEV_KEY_OPT_IN_VAR] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/**
 * Resolve which key this process is entitled to use — or throw. Pure: no
 * side effects, no logging, no secrets in the message.
 *
 * Ordering is load-bearing. The production branch is checked *before* the
 * opt-in, so `MINION_ALLOW_DEV_CRYPTO_KEY=1` in a production environment still
 * throws the production message. An env var that could downgrade production
 * crypto would be a worse bug than the one being fixed.
 */
export function cryptoKeyMode(): CryptoKeyMode {
  if (process.env.ENCRYPTION_KEY) return 'configured';
  if (process.env.NODE_ENV === 'production') {
    throw new Error(PRODUCTION_KEY_REQUIRED_MESSAGE);
  }
  if (!devKeyOptIn()) {
    throw new Error(DEV_KEY_REFUSED_MESSAGE);
  }
  return 'dev-fallback';
}

let warnedAboutDevKey = false;

/**
 * Call once at server startup so a missing key is a boot failure with a named
 * error, not a runtime surprise on the first secret read or write. Throws
 * exactly when {@link cryptoKeyMode} throws; otherwise returns void, warning
 * once per process when the environment is running on the development key.
 */
export function assertCryptoKeyConfigured(): void {
  const mode = cryptoKeyMode();
  if (mode !== 'dev-fallback' || warnedAboutDevKey) return;
  warnedAboutDevKey = true;
  // The acceptance signal for the rollout: seeing this line in a deployed
  // environment's logs means that environment is still on the dev key.
  console.warn(
    `[crypto] ENCRYPTION_KEY is not set; sealing and opening secrets with the built-in ` +
      `development key because ${DEV_KEY_OPT_IN_VAR} is set. Anything stored this way is ` +
      `NOT confidential. Never do this in a deployed environment.`,
  );
}
