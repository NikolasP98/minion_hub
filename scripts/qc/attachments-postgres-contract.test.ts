import { describe, it, expect } from 'vitest';
import { assertAttachmentsPostgresReport } from './attachments-postgres-contract';
import { nativePostgresAdmissions } from './native-postgres-manifest';
const total = nativePostgresAdmissions('attachments').reduce(
  (sum, admission) => sum + admission.minimumAssertions,
  0,
);
const complete = () => ({
  success: true,
  numTotalTests: total,
  numPassedTests: total,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numRuntimeErrorTestSuites: 0,
  testResults: nativePostgresAdmissions('attachments').map((admission) => ({
    name: `/fixture/${admission.file}`,
    status: 'passed',
    assertionResults: Array.from({ length: admission.minimumAssertions }, (_, index) => ({
      status: 'passed',
      fullName: admission.requiredBehaviors[index] ?? `supplementary behavior ${index}`,
    })),
  })),
});
describe('attachment native evidence gate', () => {
  it('accepts every declared suite with consistent nonempty passed assertions', () => {
    expect(assertAttachmentsPostgresReport(complete())).toEqual({
      files: 2,
      passed: total,
      skipped: 0,
    });
  });
  it.each([
    'missing',
    'duplicate',
    'empty',
    'skipped',
    'runtime-error',
    'totals',
    'failed',
  ] as const)('refuses %s evidence', (kind) => {
    const report = complete();
    if (kind === 'missing') report.testResults.pop();
    if (kind === 'duplicate') report.testResults[1] = report.testResults[0];
    if (kind === 'empty') report.testResults[0].assertionResults = [];
    if (kind === 'skipped') report.testResults[0].assertionResults[0].status = 'pending';
    if (kind === 'runtime-error') report.numRuntimeErrorTestSuites = 1;
    if (kind === 'totals') report.numTotalTests = report.numPassedTests = 3;
    if (kind === 'failed') report.testResults[0].status = 'failed';
    expect(() => assertAttachmentsPostgresReport(report)).toThrow();
  });
});
