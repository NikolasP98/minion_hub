import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEPENDENCY_SECURITY_CASES,
  assertExpectedDependencyMutationFailure,
} from './dependency-security-mutation-contract.mjs';

const require = createRequire(import.meta.url);

function passingMutationReceipt(mutation: 'editor-paste' | 'ordinary-sanitizer') {
  const failedCase =
    mutation === 'editor-paste' ? 'DS2 editor paste and Markdown' : 'DS3 ordinary sanitizer';
  const failedInvariant = mutation === 'editor-paste' ? 'unsafe paste' : 'executable HTML';
  const checkByTitle: Record<string, string> = {
    'DS1 prototype attributes': 'prototype attributes',
    'DS2 editor paste and Markdown': 'editor paste and Markdown',
    'DS3 ordinary sanitizer': 'ordinary sanitizer',
    'DS4 detached sanitizer subtree': 'detached sanitizer subtree',
  };
  return {
    mutation,
    processResult: { code: 1, signal: null },
    runner: {
      status: 'failed',
      error: 'Dependency browser qualification failed',
      mutation,
      build: { code: 0, signal: null },
      browser: { code: 1, signal: null },
      shutdown: { stopped: true, forced: false },
    },
    report: {
      status: 'failed',
      expected: [...DEPENDENCY_SECURITY_CASES],
      discovered: DEPENDENCY_SECURITY_CASES.map((title) => ({ title, project: 'chromium' })),
      results: DEPENDENCY_SECURITY_CASES.map((title) => ({
        title,
        project: 'chromium',
        status: title === failedCase ? 'failed' : 'passed',
        evidence: ['check-result', 'network-boundary', 'runtime-identity'],
        checkResult:
          title === failedCase
            ? {
                name: checkByTitle[title],
                mutation,
                passed: false,
                failure: { kind: 'fixture-invariant', invariant: failedInvariant },
              }
            : { name: checkByTitle[title], mutation, passed: true },
        networkBoundary: {
          allowedOrigin: 'http://127.0.0.1:18904',
          unexpected: [] as string[],
        },
        runtimeIdentity: { browser: '152.0.0.0', project: 'chromium', auth: 'none' },
        errors:
          title === failedCase
            ? [`Error: DEPENDENCY_SECURITY_FIXTURE_INVARIANT:${failedInvariant}`]
            : [],
        evidenceError: null,
      })),
      artifact: { mutation, boundary: { violations: 0 } },
      artifactError: null,
      mutation,
    },
  };
}

describe('dependency security mutation qualification', () => {
  it.each(['editor-paste', 'ordinary-sanitizer'] as const)(
    'accepts only the exact %s browser failure',
    (mutation) => {
      expect(assertExpectedDependencyMutationFailure(passingMutationReceipt(mutation))).toEqual({
        mutation,
        failedCase:
          mutation === 'editor-paste' ? 'DS2 editor paste and Markdown' : 'DS3 ordinary sanitizer',
        discovered: 4,
      });
    },
  );

  it('rejects an always-green mutation lane', () => {
    const input = passingMutationReceipt('ordinary-sanitizer');
    input.processResult.code = 0;
    input.runner.status = 'passed';
    input.report.status = 'passed';
    input.report.results[2]!.status = 'passed';
    expect(() => assertExpectedDependencyMutationFailure(input)).toThrow(
      'Mutation runner did not exit with an ordinary nonzero status',
    );
  });

  it('pins the exact Playwright reporter spelling for the expected fixture error', () => {
    const utilPath = join(dirname(require.resolve('playwright/package.json')), 'lib', 'util.js');
    const { serializeError } = require(utilPath) as {
      serializeError(error: Error): { message: string };
    };
    expect(
      serializeError(new Error('DEPENDENCY_SECURITY_FIXTURE_INVARIANT:unsafe paste')).message,
    ).toBe('Error: DEPENDENCY_SECURITY_FIXTURE_INVARIANT:unsafe paste');
  });

  it('rejects a skip, duplicate, wrong failure, or unproven artifact', () => {
    const skipped = passingMutationReceipt('editor-paste');
    skipped.report.results[1]!.status = 'skipped';
    expect(() => assertExpectedDependencyMutationFailure(skipped)).toThrow(
      'Expected failing dependency case',
    );

    const duplicate = passingMutationReceipt('editor-paste');
    duplicate.report.results[3] = { ...duplicate.report.results[1]! };
    expect(() => assertExpectedDependencyMutationFailure(duplicate)).toThrow(
      'Mutation result was missing or duplicated',
    );

    const wrongFailure = passingMutationReceipt('editor-paste');
    wrongFailure.report.results[1]!.status = 'passed';
    wrongFailure.report.results[2]!.status = 'failed';
    expect(() => assertExpectedDependencyMutationFailure(wrongFailure)).toThrow(
      'Expected failing dependency case',
    );

    const boundary = passingMutationReceipt('ordinary-sanitizer');
    boundary.report.artifact.boundary.violations = 1;
    expect(() => assertExpectedDependencyMutationFailure(boundary)).toThrow(
      'Mutation artifact did not prove',
    );
  });

  it('rejects the right case failing for the wrong reason or unrelated errors', () => {
    const wrongInvariant = passingMutationReceipt('editor-paste');
    wrongInvariant.report.results[1]!.checkResult = {
      name: 'editor paste and Markdown',
      mutation: 'editor-paste',
      passed: false,
      failure: { kind: 'fixture-invariant', invariant: 'Markdown serialization' },
    };
    expect(() => assertExpectedDependencyMutationFailure(wrongInvariant)).toThrow(
      'Mutation failed outside its exact fixture invariant',
    );

    const unrelatedError = passingMutationReceipt('ordinary-sanitizer');
    unrelatedError.report.results[2]!.errors.push('page navigation failed');
    expect(() => assertExpectedDependencyMutationFailure(unrelatedError)).toThrow(
      'Mutation test had an unrelated failure',
    );

    const network = passingMutationReceipt('ordinary-sanitizer');
    network.report.results[2]!.networkBoundary.unexpected.push('GET https://example.invalid');
    expect(() => assertExpectedDependencyMutationFailure(network)).toThrow(
      'Unexpected network or page error evidence',
    );
  });

  it('rejects empty or forged structured evidence', () => {
    const empty = passingMutationReceipt('editor-paste');
    (empty.report.results[1]! as { checkResult: unknown }).checkResult = null;
    expect(() => assertExpectedDependencyMutationFailure(empty)).toThrow(
      'Mutation failed outside its exact fixture invariant',
    );

    const forged = passingMutationReceipt('ordinary-sanitizer');
    forged.report.results[2]!.runtimeIdentity = {
      browser: '',
      project: 'chromium',
      auth: 'none',
    };
    expect(() => assertExpectedDependencyMutationFailure(forged)).toThrow(
      'Invalid runtime identity evidence',
    );

    const missing = passingMutationReceipt('editor-paste');
    missing.report.results[1]!.evidence = ['check-result', 'network-boundary'];
    expect(() => assertExpectedDependencyMutationFailure(missing)).toThrow(
      'Missing or duplicate runtime-identity evidence',
    );
  });

  it('keeps the exact runner and mutation qualifier on the dedicated CI path', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['test:dependency-browser']).toBe(
      'node scripts/qc/run-dependency-security.mjs',
    );
    expect(packageJson.scripts['test:dependency-browser-mutations']).toBe(
      'node scripts/qc/qualify-dependency-security-mutations.mjs',
    );

    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toMatch(/Run all four native dependency checks/);
    expect(workflow).toMatch(/Prove editor and sanitizer mutations make the browser lane red/);
    expect(workflow).toMatch(/MINION_DEPENDENCY_MUTATION_RUN_ROOT:/);
  });
});
