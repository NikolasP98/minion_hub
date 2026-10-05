import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativePostgresFiles } from './native-postgres-manifest';
import { assertNativePostgresReport } from './native-postgres-report';

/** Exact root-admitted native lane; never discover arbitrary SQL fixtures. */
export const PRINCIPAL_POSTGRES_FILES = nativePostgresFiles('principal');

export function assertPrincipalPostgresReport(value: unknown) {
  return assertNativePostgresReport('principal', value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error('Native JSON report path required');
  console.log(
    JSON.stringify(assertPrincipalPostgresReport(JSON.parse(readFileSync(file, 'utf8')))),
  );
}
