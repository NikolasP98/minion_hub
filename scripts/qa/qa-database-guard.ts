/**
 * Never-prod guard for the QA stack scripts (db-bootstrap.ts, and later
 * S2/S3's up/reset/seed scripts). Mirrors the loopback-only spirit of
 * scripts/qc/disposable-postgres.ts's `validateDisposableDatabaseUrl`, but
 * scoped to this stack's fixed local port (54422) instead of that fixture's
 * `minion_qc_*` naming convention.
 *
 * Pure and side-effect free: no connection is opened here, only the URL is
 * parsed and validated.
 */

export const QA_STACK_DB_PORT = '54422';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', '[::1]']);

export interface QaDatabaseUrlOptions {
  /** Corresponds to the CLI flag `--allow-port` — skips the port==54422 check. */
  allowPort?: boolean;
}

/**
 * Throws unless `raw` is a postgres(ql):// URL pointing at loopback on the
 * QA stack's fixed port (54422), so this pipeline can never be pointed at a
 * shared, staging or production database by a typo or a stale shell env var.
 */
export function validateQaDatabaseUrl(
  raw: string | undefined,
  options: QaDatabaseUrlOptions = {},
): URL {
  if (!raw) {
    throw new Error('A database URL is required (--db-url, defaults to the local QA stack)');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid database URL: ${raw}`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(
      `Refusing non-Postgres protocol "${url.protocol}" — expected postgres:// or postgresql://`,
    );
  }
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      `Refusing non-loopback database host "${url.hostname}" — the QA stack never connects to a remote database`,
    );
  }
  if (!options.allowPort && url.port !== QA_STACK_DB_PORT) {
    throw new Error(
      `Refusing port "${url.port || '(default)'}" — expected the QA stack's db port ${QA_STACK_DB_PORT} ` +
        '(pass --allow-port to use a different loopback port deliberately)',
    );
  }
  return url;
}
