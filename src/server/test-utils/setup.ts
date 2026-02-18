/**
 * Vitest global setup — runs before every test file.
 *
 * Sets safe env defaults so that modules like db/client.ts and storage/b2.ts
 * don't accidentally connect to real services if imported without mocking.
 */
process.env.TURSO_DB_URL ??= 'file::memory:';
process.env.TURSO_DB_AUTH_TOKEN ??= '';
process.env.B2_ENDPOINT ??= 'http://localhost:0';
process.env.B2_KEY_ID ??= 'test-key-id';
process.env.B2_APP_KEY ??= 'test-app-key';
process.env.B2_BUCKET_NAME ??= 'test-bucket';
