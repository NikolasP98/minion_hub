import { describe, expect, it } from 'vitest';
import {
  NATIVE_POSTGRES_LANES,
  nativePostgresAdmissions,
  type NativePostgresLane,
} from './native-postgres-manifest';
import { assertNativePostgresReport } from './native-postgres-report';

type MutableReport = ReturnType<typeof completeReport>;

function completeReport(lane: NativePostgresLane) {
  const testResults = nativePostgresAdmissions(lane).map((admission) => ({
    name: `/fixture/${admission.file}`,
    status: 'passed',
    assertionResults: Array.from({ length: admission.minimumAssertions }, (_, index) => ({
      status: 'passed',
      fullName: admission.requiredBehaviors[index] ?? `supplementary behavior ${index}`,
    })),
  }));
  const total = testResults.reduce((sum, result) => sum + result.assertionResults.length, 0);
  return {
    success: true,
    numTotalTests: total,
    numPassedTests: total,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numRuntimeErrorTestSuites: 0,
    testResults,
  };
}

function firstWithCount(lane: NativePostgresLane, minimum: number) {
  const index = nativePostgresAdmissions(lane).findIndex(
    ({ minimumAssertions }) => minimumAssertions >= minimum,
  );
  if (index < 0) throw new Error(`No ${lane} fixture has ${minimum} assertions`);
  return index;
}

describe('native PostgreSQL semantic report gate', () => {
  it.each(NATIVE_POSTGRES_LANES)('accepts the complete %s lane contract', (lane) => {
    const report = completeReport(lane);
    expect(assertNativePostgresReport(lane, report)).toEqual({
      files: report.testResults.length,
      passed: report.numTotalTests,
      skipped: 0,
    });
  });

  it('rejects one generic pass per file even when every file is present', () => {
    const report = completeReport('jobs');
    for (const result of report.testResults) result.assertionResults.splice(1);
    report.numTotalTests = report.numPassedTests = report.testResults.length;
    expect(() => assertNativePostgresReport('jobs', report)).toThrow('incomplete');
  });

  it.each(['missing', 'renamed'] as const)('rejects a %s required behavior', (kind) => {
    const report = completeReport('attachments');
    const required = nativePostgresAdmissions('attachments')[0].requiredBehaviors[0];
    const assertion = report.testResults[0].assertionResults.find(
      ({ fullName }) => fullName === required,
    );
    expect(assertion).toBeDefined();
    assertion!.fullName = kind === 'missing' ? undefined : `${required} renamed`;
    expect(() => assertNativePostgresReport('attachments', report)).toThrow(
      'Native behavior missing',
    );
  });

  it('rejects a below-ratchet report', () => {
    const report = completeReport('principal');
    report.testResults[0].assertionResults.pop();
    report.numTotalTests = report.numPassedTests = report.testResults[0].assertionResults.length;
    expect(() => assertNativePostgresReport('principal', report)).toThrow('incomplete');
  });

  it.each(['file', 'pending', 'failure'] as const)('rejects a missing or nonpassing %s', (kind) => {
    const lane = 'qa-native';
    const report: MutableReport = completeReport(lane);
    if (kind === 'file') report.testResults.pop();
    if (kind === 'pending') {
      report.numPendingTests = 1;
      report.testResults[0].assertionResults[0].status = 'pending';
    }
    if (kind === 'failure') {
      report.success = false;
      report.numFailedTests = 1;
    }
    expect(() => assertNativePostgresReport(lane, report)).toThrow();
  });

  it('accepts an added passing behavior without weakening required names or the ratchet', () => {
    const lane = 'jobs';
    const report = completeReport(lane);
    const index = firstWithCount(lane, 2);
    report.testResults[index].assertionResults.push({
      status: 'passed',
      fullName: 'new reviewed behavior',
    });
    report.numTotalTests += 1;
    report.numPassedTests += 1;
    expect(assertNativePostgresReport(lane, report).passed).toBe(report.numTotalTests);
  });
});
