/**
 * Vitest global setup — runs before every test file.
 *
 * Sets safe env defaults so that modules like db/client.ts and storage/blob.ts
 * don't accidentally connect to real services if imported without mocking.
 */
// Crypto: tests must never fall through to @minion-stack/db's built-in
// development key (specs/2026-08-17-pkg-dev-crypto-failopen-spec.md). A fixed,
// obviously-throwaway key keeps roundtrips deterministic; the fail-closed matrix
// in src/server/auth/crypto-key.test.ts deletes it per case.
process.env.ENCRYPTION_KEY ||= 'test-key-do-not-use-in-prod';
process.env.TURSO_DB_URL ??= 'file::memory:';
process.env.TURSO_DB_AUTH_TOKEN ??= '';
process.env.B2_ENDPOINT ??= 'http://localhost:0';
process.env.B2_KEY_ID ??= 'test-key-id';
process.env.B2_APP_KEY ??= 'test-app-key';
process.env.B2_BUCKET_NAME ??= 'test-bucket';

import { configureCache, createBackend } from '@minion-stack/cache';

configureCache({ namespace: 'test', backend: createBackend({ backend: 'noop' }) });
