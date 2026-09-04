// App-level secret encryption for the hub. The implementation now lives in
// @minion-stack/db/crypto (R7 of specs/2026-05-26-auth-token-simplification.md)
// so there is ONE canonical AES-256-GCM impl + key-derivation path shared with
// the PG identity helpers, instead of a byte-matched copy maintained here.
//
// Same names, same ciphertext layout, same key derivation
// (scryptSync(ENCRYPTION_KEY, 'minion-hub-salt', 32)) — existing encrypted
// tokens at rest remain readable.
export { encrypt, decrypt, encryptToken, decryptToken } from '@minion-stack/db/crypto';

// Key-configuration policy (S3 of the 2026-08-17 crypto fail-open spec). Kept
// beside the re-export so every caller has one import path for "can this
// process legitimately touch secrets?".
export {
  assertCryptoKeyConfigured,
  cryptoKeyMode,
  DEV_KEY_OPT_IN_VAR,
  DEV_KEY_REFUSED_MESSAGE,
  PRODUCTION_KEY_REQUIRED_MESSAGE,
  type CryptoKeyMode,
} from './crypto-key';
