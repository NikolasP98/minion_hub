import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDisposableDatabaseUrl } from './disposable-postgres';

/** Exact root-admitted native lane; never discover arbitrary SQL fixtures. */
export const JOBS_POSTGRES_FILES = [
  'src/server/services/job-stock-concurrency.sql.integration.test.ts',
  'src/server/services/job-effects.sql.integration.test.ts',
  'src/server/services/job-effect-pages.sql.integration.test.ts',
  'src/server/services/finance-statements.effect-ownership.sql.integration.test.ts',
  'src/server/services/brain-corpus.effect-ownership.sql.integration.test.ts',
] as const;

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

type Assertion = { status?: string };
type Result = { name?: string; status?: string; assertionResults?: Assertion[] };
type Report = {
  success?: boolean;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  numRuntimeErrorTestSuites?: number;
  testResults?: Result[];
};

export function assertJobsPostgresReport(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Missing native report');
  const report = value as Report;
  if (
    !report.success ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    (report.numTodoTests ?? 0) !== 0 ||
    (report.numRuntimeErrorTestSuites ?? 0) !== 0 ||
    !report.numTotalTests ||
    report.numPassedTests !== report.numTotalTests
  ) {
    throw new Error('Native lane failed, skipped, empty or incomplete');
  }
  if (
    !Array.isArray(report.testResults) ||
    report.testResults.length !== JOBS_POSTGRES_FILES.length
  ) {
    throw new Error('Native lane must include every admitted file exactly once');
  }
  let total = 0;
  for (const file of JOBS_POSTGRES_FILES) {
    const rows = report.testResults.filter((row) =>
      row.name?.replaceAll('\\', '/').endsWith(`/${file}`),
    );
    if (
      rows.length !== 1 ||
      rows[0].status !== 'passed' ||
      !rows[0].assertionResults?.length ||
      rows[0].assertionResults.some((test) => test.status !== 'passed')
    ) {
      throw new Error(`Native fixture incomplete: ${file}`);
    }
    total += rows[0].assertionResults.length;
  }
  if (total !== report.numTotalTests) throw new Error('Native assertion totals disagree');
  return { files: JOBS_POSTGRES_FILES.length, passed: total, skipped: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error('Native JSON report path required');
  console.log(JSON.stringify(assertJobsPostgresReport(JSON.parse(readFileSync(file, 'utf8')))));
}
