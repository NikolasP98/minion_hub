import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertJobsPostgresReport,
  JOBS_POSTGRES_FILES,
  validateJobsPostgresLane,
} from './jobs-postgres-contract';

const environment = {
  REQUIRE_JOBS_POSTGRES: '1',
  MINION_QC_DISPOSABLE: '1',
  MINION_QC_DATABASE_URL: 'postgres://minion_qc@127.0.0.1:55461/minion_qc_corpus',
};
const report = () => ({
  success: true,
  numTotalTests: 5,
  numPassedTests: 5,
  numFailedTests: 0,
  numPendingTests: 0,
  testResults: JOBS_POSTGRES_FILES.map((file) => ({
    name: `/fixture/${file}`,
    status: 'passed',
    assertionResults: [{ status: 'passed' }],
  })),
});
describe('marked jobs PostgreSQL lane admission', () => {
  it('requires both opt-ins and the fixture URL without connecting to SQL', () => {
    expect(() => validateJobsPostgresLane(environment, '/fixture', () => true)).not.toThrow();
    for (const key of Object.keys(environment)) {
      const missing = { ...environment };
      delete missing[key as keyof typeof missing];
      expect(() => validateJobsPostgresLane(missing, '/fixture', () => true)).toThrow();
    }
    expect(() =>
      validateJobsPostgresLane(
        { ...environment, REQUIRE_JOBS_POSTGRES: '0' },
        '/fixture',
        () => true,
      ),
    ).toThrow();
    expect(() =>
      validateJobsPostgresLane(
        {
          ...environment,
          MINION_QC_DATABASE_URL: 'postgres://minion_qc@db.example:5432/minion_qc_corpus',
        },
        '/fixture',
        () => true,
      ),
    ).toThrow();
  });
  it('rejects an absent admitted file before fixture imports', () => {
    expect(() =>
      validateJobsPostgresLane(
        environment,
        '/fixture',
        (file) => !file.endsWith(JOBS_POSTGRES_FILES[0]),
      ),
    ).toThrow('Missing admitted native fixture');
  });
  it('accepts only all admitted files with actual passing assertions', () => {
    expect(assertJobsPostgresReport(report())).toEqual({ files: 5, passed: 5, skipped: 0 });
    expect(() =>
      assertJobsPostgresReport({
        ...report(),
        numTotalTests: 0,
        numPassedTests: 0,
        testResults: [],
      }),
    ).toThrow();
    expect(() =>
      assertJobsPostgresReport({ ...report(), testResults: report().testResults.slice(1) }),
    ).toThrow();
    expect(() => assertJobsPostgresReport({ ...report(), numPendingTests: 1 })).toThrow();
    expect(() => assertJobsPostgresReport({ ...report(), numFailedTests: 1 })).toThrow();
    expect(() => assertJobsPostgresReport({ ...report(), numRuntimeErrorTestSuites: 1 })).toThrow();
    const skipped = report();
    skipped.testResults[0].assertionResults[0].status = 'pending';
    expect(() => assertJobsPostgresReport(skipped)).toThrow();
    const empty = report();
    empty.testResults[0].assertionResults = [];
    expect(() => assertJobsPostgresReport(empty)).toThrow();
    const duplicate = report();
    duplicate.testResults[0] = duplicate.testResults[1];
    expect(() => assertJobsPostgresReport(duplicate)).toThrow();
  });
});

it('excludes backend fault execution from every admitted native source', () => {
  for (const file of JOBS_POSTGRES_FILES) {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/pg_terminate_backend|pg_cancel_backend/);
    expect(source).not.toMatch(/import[^\n]*backend-fault\.fixture/);
  }
  expect(JOBS_POSTGRES_FILES.every((file) => file.endsWith('.sql.integration.test.ts'))).toBe(true);
});
