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
    const index = report.testResults[0].assertionResults.findIndex(
      ({ fullName }) => fullName === required,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    report.testResults[0].assertionResults[index].fullName =
      kind === 'missing' ? 'unrelated replacement behavior' : `${required} renamed`;
    expect(() => assertNativePostgresReport('attachments', report)).toThrow(
      'Native behavior missing',
    );
  });

  it('rejects an unnamed passing behavior', () => {
    const report = completeReport('attachments');
    (report.testResults[0].assertionResults[0] as { fullName?: string }).fullName = undefined;
    expect(() => assertNativePostgresReport('attachments', report)).toThrow('unnamed behavior');
  });

  it('rejects duplicate passing behavior names within a file', () => {
    const report = completeReport('jobs');
    report.testResults[0].assertionResults[1].fullName =
      report.testResults[0].assertionResults[0].fullName;
    expect(() => assertNativePostgresReport('jobs', report)).toThrow('repeats a behavior name');
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

  describe('exactAssertions admission', () => {
    const AUDIT = 'src/server/services/pos/accounts/audit.sql.integration.test.ts';
    const auditRow = (report: MutableReport) =>
      report.testResults.find((row) => row.name.endsWith(`/${AUDIT}`))!;
    const bump = (report: MutableReport) => {
      report.numTotalTests += 1;
      report.numPassedTests += 1;
    };

    it('accepts the exact eight-name set', () => {
      const report = completeReport('qa-native');
      expect(auditRow(report).assertionResults).toHaveLength(8);
      expect(assertNativePostgresReport('qa-native', report).passed).toBe(report.numTotalTests);
    });

    it('rejects an extra passing assertion when exactAssertions is true', () => {
      const report = completeReport('qa-native');
      auditRow(report).assertionResults.push({ status: 'passed', fullName: 'extra behavior' });
      bump(report);
      expect(() => assertNativePostgresReport('qa-native', report)).toThrow(
        `Native fixture assertion count mismatch: ${AUDIT}`,
      );
    });

    it.each(['missing', 'duplicate', 'unnamed', 'failed', 'skipped'] as const)(
      'rejects a %s required behavior',
      (kind) => {
        const report = completeReport('qa-native');
        const results = auditRow(report).assertionResults;
        if (kind === 'missing') {
          results.pop();
          report.numTotalTests -= 1;
          report.numPassedTests -= 1;
        }
        if (kind === 'duplicate') results[1].fullName = results[0].fullName;
        if (kind === 'unnamed') results[0].fullName = '';
        if (kind === 'failed' || kind === 'skipped') {
          results[0].status = kind === 'failed' ? 'failed' : 'skipped';
        }
        expect(() => assertNativePostgresReport('qa-native', report)).toThrow();
      },
    );

    it('keeps an omitted flag additive for legacy admissions', () => {
      const report = completeReport('qa-native');
      const legacy = report.testResults.find((row) => !row.name.endsWith(`/${AUDIT}`))!;
      legacy.assertionResults.push({ status: 'passed', fullName: 'extra legacy behavior' });
      bump(report);
      expect(assertNativePostgresReport('qa-native', report).passed).toBe(report.numTotalTests);
    });
  });
});
