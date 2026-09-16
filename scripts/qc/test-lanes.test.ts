import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const nativeFiles = [
  'src/server/services/job-effects.sql.integration.test.ts',
  'src/server/services/job-stock-concurrency.sql.integration.test.ts',
];
const validFixture = 'postgres://minion_qc@127.0.0.1:55439/minion_qc_jobs_stock';

function discover(
  config?: string,
  environment: Record<string, string> = {},
  filter?: string,
  execute = false,
) {
  return spawnSync(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      ...(execute ? ['run'] : ['list', '--filesOnly']),
      ...(config ? ['--config', config] : []),
      ...(filter ? [filter] : []),
      // --json accepts an optional output path; keep it last to avoid writing a test file.
      ...(!execute ? ['--json'] : []),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        CI: '1',
        NO_COLOR: '1',
        // Files-only discovery must not import a legacy SQL module or use this URL.
        SUPABASE_DB_URL: 'postgres://synthetic@127.0.0.1:1/never_connect',
        ...environment,
      },
    },
  );
}

function files(result: ReturnType<typeof discover>) {
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { file: string }[]).map(({ file }) =>
    file.replace(root, ''),
  );
}

describe('offline and disposable SQL test discovery', { timeout: 30_000 }, () => {
  it('keeps SQL modules out of ordinary unit collection while retaining unit families', () => {
    const selected = files(discover());
    expect(selected.some((file) => file.endsWith('.sql.integration.test.ts'))).toBe(false);
    expect(selected).not.toContain(
      'src/server/services/brain-business-persistence.service.test.ts',
    );
    expect(selected).not.toContain('src/server/services/crm-funnel.concurrent.integration.test.ts');
    expect(selected).toContain('src/server/services/bg-runtime.test.ts');
    expect(selected).toContain('tests/dependencies/security-compatibility.test.ts');
    expect(selected).toContain('scripts/qc/test-lanes.test.ts');
  });

  it('admits only the exact reviewed disposable fixtures', () => {
    expect(
      files(
        discover('vitest.disposable.config.ts', {
          MINION_QC_DISPOSABLE: '1',
          MINION_QC_DATABASE_URL: validFixture,
        }),
      ).sort(),
    ).toEqual(nativeFiles);
  });

  it.each([
    {},
    { MINION_QC_DISPOSABLE: '1' },
    { MINION_QC_DISPOSABLE: '0', MINION_QC_DATABASE_URL: validFixture },
    {
      MINION_QC_DISPOSABLE: '1',
      MINION_QC_DATABASE_URL: 'postgres://minion_qc@database.example:5432/minion_qc_jobs_stock',
    },
  ])('fails qualification configuration without explicit valid fixture input: %j', (env) => {
    const result = discover('vitest.disposable.config.ts', env);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/disposable|MINION_QC/i);
  });

  it.each([
    'src/server/services/brain-business-corpus.sql.integration.test.ts',
    'src/server/services/not-an-admitted-fixture.sql.integration.test.ts',
  ])('fails an empty or legacy selection before importing it: %s', (filter) => {
    const result = discover(
      'vitest.disposable.config.ts',
      { MINION_QC_DISPOSABLE: '1', MINION_QC_DATABASE_URL: validFixture },
      filter,
      true,
    );
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
  });
});
