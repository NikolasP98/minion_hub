/**
 * Database URL for the SQL integration suites (`*.integration.test.ts`).
 *
 * NEVER the app's `SUPABASE_DB_URL` from `.env`: that is PRODUCTION, and these
 * suites run `create schema` + session-level `set search_path` through the
 * transaction pooler — a leaked `search_path` poisons pooled backends for every
 * other client ("relation … does not exist" across the whole hub, 2026-09-03).
 *
 * Resolution: `HUB_TEST_DB_URL` (a throwaway database), else — in CI only, where
 * the postgres jobs export a job-scoped URL — `SUPABASE_DB_URL`. Locally the
 * suites skip unless `HUB_TEST_DB_URL` is set.
 */
export function testDatabaseUrl(): string | undefined {
  const explicit = process.env.HUB_TEST_DB_URL;
  if (explicit) return explicit;
  if (process.env.CI || process.env.GITHUB_ACTIONS) return process.env.SUPABASE_DB_URL;
  return undefined;
}
