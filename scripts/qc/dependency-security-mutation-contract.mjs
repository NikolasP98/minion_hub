export const DEPENDENCY_SECURITY_CASES = Object.freeze([
  'DS1 prototype attributes',
  'DS2 editor paste and Markdown',
  'DS3 ordinary sanitizer',
  'DS4 detached sanitizer subtree',
]);

export const DEPENDENCY_SECURITY_MUTATIONS = Object.freeze({
  'editor-paste': 'DS2 editor paste and Markdown',
  'ordinary-sanitizer': 'DS3 ordinary sanitizer',
});

const CHECK_BY_TITLE = Object.freeze({
  'DS1 prototype attributes': 'prototype attributes',
  'DS2 editor paste and Markdown': 'editor paste and Markdown',
  'DS3 ordinary sanitizer': 'ordinary sanitizer',
  'DS4 detached sanitizer subtree': 'detached sanitizer subtree',
});

const INVARIANT_BY_MUTATION = Object.freeze({
  'editor-paste': 'unsafe paste',
  'ordinary-sanitizer': 'executable HTML',
});

/** @param {unknown} value @param {string} message */
function invariant(value, message) {
  if (!value) throw new Error(message);
}

/** @param {unknown} left @param {unknown} right */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * @param {{
 *   entry: {
 *     title?: string,
 *     project?: string,
 *     status?: string,
 *     evidence?: string[],
 *     checkResult?: unknown,
 *     networkBoundary?: unknown,
 *     runtimeIdentity?: unknown,
 *     errors?: string[],
 *     evidenceError?: string | null
 *   },
 *   mutation: string,
 *   expectedInvariant: string | null
 * }} input
 */
export function assertDependencyCaseEvidence({ entry, mutation, expectedInvariant }) {
  const check = CHECK_BY_TITLE[/** @type {keyof typeof CHECK_BY_TITLE} */ (entry.title)];
  invariant(check, `Unknown dependency case evidence: ${String(entry.title)}`);
  invariant(entry.project === 'chromium', `Wrong dependency project: ${entry.title}`);
  invariant(entry.evidenceError === null, `Invalid dependency evidence: ${entry.title}`);
  for (const name of ['check-result', 'network-boundary', 'runtime-identity']) {
    invariant(
      entry.evidence?.filter((candidate) => candidate === name).length === 1,
      `Missing or duplicate ${name} evidence: ${entry.title}`,
    );
  }
  invariant(
    sameJson(entry.networkBoundary, {
      allowedOrigin: 'http://127.0.0.1:18904',
      unexpected: [],
    }),
    `Unexpected network or page error evidence: ${entry.title}`,
  );
  const runtime = entry.runtimeIdentity;
  invariant(
    typeof runtime === 'object' &&
      runtime !== null &&
      sameJson(Object.keys(runtime).sort(), ['auth', 'browser', 'project']) &&
      'browser' in runtime &&
      typeof runtime.browser === 'string' &&
      runtime.browser.length > 0 &&
      runtime.browser.length <= 128 &&
      'project' in runtime &&
      runtime.project === 'chromium' &&
      'auth' in runtime &&
      runtime.auth === 'none',
    `Invalid runtime identity evidence: ${entry.title}`,
  );

  if (expectedInvariant === null) {
    invariant(entry.status === 'passed', `Expected passing dependency case: ${entry.title}`);
    invariant(
      sameJson(entry.checkResult, { name: check, mutation, passed: true }),
      `Invalid passing check result: ${entry.title}`,
    );
    invariant(sameJson(entry.errors, []), `Passing dependency case had errors: ${entry.title}`);
  } else {
    invariant(entry.status === 'failed', `Expected failing dependency case: ${entry.title}`);
    invariant(
      sameJson(entry.checkResult, {
        name: check,
        mutation,
        passed: false,
        failure: { kind: 'fixture-invariant', invariant: expectedInvariant },
      }),
      `Mutation failed outside its exact fixture invariant: ${entry.title}`,
    );
    invariant(
      sameJson(entry.errors, [`Error: DEPENDENCY_SECURITY_FIXTURE_INVARIANT:${expectedInvariant}`]),
      `Mutation test had an unrelated failure: ${entry.title}`,
    );
  }
}

/**
 * A mutation qualifier is allowed to turn green only when the exact real browser lane
 * ran all four cases and precisely the behavior selected by the bundled mutation failed.
 *
 * @param {{
 *   mutation: keyof typeof DEPENDENCY_SECURITY_MUTATIONS,
 *   processResult: {code: number | null, signal: string | null},
 *   runner: {
 *     status?: string,
 *     error?: string | null,
 *     mutation?: string,
 *     build?: {code?: number | null, signal?: string | null} | null,
 *     browser?: {code?: number | null, signal?: string | null} | null,
 *     shutdown?: {stopped?: boolean, forced?: boolean} | null
 *   },
 *   report: {
 *     status?: string,
 *     expected?: unknown,
 *     discovered?: Array<{title?: string, project?: string}>,
 *     results?: Array<{
 *       title?: string,
 *       project?: string,
 *       status?: string,
 *       evidence?: string[],
 *       checkResult?: unknown,
 *       networkBoundary?: unknown,
 *       runtimeIdentity?: unknown,
 *       errors?: string[],
 *       evidenceError?: string | null
 *     }>,
 *     artifact?: {mutation?: string, boundary?: {violations?: number}} | null,
 *     artifactError?: string | null,
 *     mutation?: string
 *   }
 * }} input
 */
export function assertExpectedDependencyMutationFailure(input) {
  const failedCase = DEPENDENCY_SECURITY_MUTATIONS[input.mutation];
  invariant(failedCase, `Unknown dependency mutation: ${String(input.mutation)}`);
  invariant(
    typeof input.processResult.code === 'number' &&
      input.processResult.code !== 0 &&
      input.processResult.signal === null,
    'Mutation runner did not exit with an ordinary nonzero status',
  );
  invariant(input.runner.status === 'failed', 'Mutation runner receipt did not fail');
  invariant(
    input.runner.error === 'Dependency browser qualification failed',
    'Mutation runner failed outside the browser qualification',
  );
  invariant(input.runner.mutation === input.mutation, 'Runner mutation identity mismatch');
  invariant(
    input.runner.build?.code === 0 && input.runner.build.signal === null,
    'Mutation fixture did not build successfully',
  );
  invariant(
    typeof input.runner.browser?.code === 'number' &&
      input.runner.browser.code !== 0 &&
      input.runner.browser.signal === null,
    'Mutation browser process did not fail normally',
  );
  invariant(
    input.runner.shutdown?.stopped === true && input.runner.shutdown.forced === false,
    'Mutation fixture server did not stop cleanly',
  );

  invariant(input.report.status === 'failed', 'Mutation browser report did not fail');
  invariant(input.report.mutation === input.mutation, 'Report mutation identity mismatch');
  invariant(input.report.artifactError === null, 'Mutation artifact identity was not stable');
  invariant(
    input.report.artifact?.mutation === input.mutation &&
      input.report.artifact.boundary?.violations === 0,
    'Mutation artifact did not prove its client boundary and mutation identity',
  );
  invariant(
    sameJson(input.report.expected, DEPENDENCY_SECURITY_CASES),
    'Mutation report expected-case contract drifted',
  );

  const expectedDiscovery = DEPENDENCY_SECURITY_CASES.map((title) => ({
    title,
    project: 'chromium',
  }));
  invariant(
    sameJson(input.report.discovered, expectedDiscovery),
    'Mutation browser discovery was missing, duplicated, reordered, or skipped',
  );
  const results = input.report.results;
  if (!Array.isArray(results) || results.length !== DEPENDENCY_SECURITY_CASES.length) {
    throw new Error('Mutation browser result count was not exact');
  }

  for (const title of DEPENDENCY_SECURITY_CASES) {
    const matches = results.filter(
      (entry) => entry.title === title && entry.project === 'chromium',
    );
    invariant(matches.length === 1, `Mutation result was missing or duplicated: ${title}`);
    const [entry] = matches;
    assertDependencyCaseEvidence({
      entry,
      mutation: input.mutation,
      expectedInvariant: title === failedCase ? INVARIANT_BY_MUTATION[input.mutation] : null,
    });
  }

  return {
    mutation: input.mutation,
    failedCase,
    discovered: DEPENDENCY_SECURITY_CASES.length,
  };
}
