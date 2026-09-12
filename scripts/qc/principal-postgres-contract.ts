import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Exact root-admitted native lane; never discover arbitrary SQL fixtures. */
export const PRINCIPAL_POSTGRES_FILES = [
  'src/server/auth/assistant-principal.sql.integration.test.ts',
] as const;

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

export function assertPrincipalPostgresReport(value: unknown) {
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
    report.testResults.length !== PRINCIPAL_POSTGRES_FILES.length
  ) {
    throw new Error('Native lane must include every admitted file exactly once');
  }
  let total = 0;
  for (const file of PRINCIPAL_POSTGRES_FILES) {
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
  return { files: PRINCIPAL_POSTGRES_FILES.length, passed: total, skipped: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error('Native JSON report path required');
  console.log(
    JSON.stringify(assertPrincipalPostgresReport(JSON.parse(readFileSync(file, 'utf8')))),
  );
}
