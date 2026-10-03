import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDisposableDatabaseUrl } from './disposable-postgres';
import { nativePostgresFiles } from './native-postgres-manifest';
import { assertNativePostgresReport } from './native-postgres-report';

/** Exact root-admitted native lane; never discover arbitrary SQL fixtures. */
export const JOBS_POSTGRES_FILES = nativePostgresFiles('jobs');

export function validateJobsPostgresLane(
  environment: NodeJS.ProcessEnv,
  root: string,
  present: (file: string) => boolean = existsSync,
) {
  if (environment.REQUIRE_JOBS_POSTGRES !== '1')
    throw new Error('REQUIRE_JOBS_POSTGRES=1 required');
  validateDisposableDatabaseUrl(
    environment.MINION_QC_DATABASE_URL,
    environment.MINION_QC_DISPOSABLE,
  );
  for (const file of JOBS_POSTGRES_FILES) {
    if (!present(path.join(root, file)))
      throw new Error(`Missing admitted native fixture: ${file}`);
  }
}

export function assertJobsPostgresReport(value: unknown) {
  return assertNativePostgresReport('jobs', value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error('Native JSON report path required');
  console.log(JSON.stringify(assertJobsPostgresReport(JSON.parse(readFileSync(file, 'utf8')))));
}
