import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativePostgresFiles } from './native-postgres-manifest';
import { assertNativePostgresReport } from './native-postgres-report';

/** Exact root-admitted native lane; never discover arbitrary SQL fixtures. */
export const ATTACHMENTS_POSTGRES_FILES = nativePostgresFiles('attachments');

export function assertAttachmentsPostgresReport(value: unknown) {
  return assertNativePostgresReport('attachments', value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error('Native JSON report path required');
  console.log(
    JSON.stringify(assertAttachmentsPostgresReport(JSON.parse(readFileSync(file, 'utf8')))),
  );
}
