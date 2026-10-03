import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NATIVE_POSTGRES_LANES,
  nativePostgresAdmissions,
  type NativePostgresLane,
} from './native-postgres-manifest';

type Assertion = { status?: string; fullName?: string };
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

export function assertNativePostgresReport(lane: NativePostgresLane, value: unknown) {
  if (!value || typeof value !== 'object') throw new Error(`Missing ${lane} native report`);
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
    throw new Error(`${lane} native lane failed, skipped, empty or incomplete`);
  }

  const admissions = nativePostgresAdmissions(lane);
  if (!Array.isArray(report.testResults) || report.testResults.length !== admissions.length) {
    throw new Error(`${lane} native lane must include every admitted file exactly once`);
  }

  let total = 0;
  for (const admission of admissions) {
    const rows = report.testResults.filter((row) =>
      row.name?.replaceAll('\\', '/').endsWith(`/${admission.file}`),
    );
    const row = rows[0];
    if (
      rows.length !== 1 ||
      row?.status !== 'passed' ||
      !row.assertionResults ||
      row.assertionResults.length < admission.minimumAssertions ||
      row.assertionResults.some((test) => test.status !== 'passed')
    ) {
      throw new Error(`Native fixture incomplete: ${admission.file}`);
    }
    const actualBehaviors = new Set(row.assertionResults.map(({ fullName }) => fullName));
    for (const behavior of admission.requiredBehaviors) {
      if (!actualBehaviors.has(behavior)) {
        throw new Error(`Native behavior missing from ${admission.file}: ${behavior}`);
      }
    }
    total += row.assertionResults.length;
  }
  if (total !== report.numTotalTests) throw new Error('Native assertion totals disagree');
  return { files: admissions.length, passed: total, skipped: 0 };
}

function parseLane(raw: string | undefined): NativePostgresLane {
  if (!raw || !NATIVE_POSTGRES_LANES.includes(raw as NativePostgresLane)) {
    throw new Error(`Native lane must be one of: ${NATIVE_POSTGRES_LANES.join(', ')}`);
  }
  return raw as NativePostgresLane;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lane = parseLane(process.argv[2]);
  const file = process.argv[3];
  if (!file) throw new Error('Native JSON report path required');
  console.log(
    JSON.stringify(assertNativePostgresReport(lane, JSON.parse(readFileSync(file, 'utf8')))),
  );
}
