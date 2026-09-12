// Excluded from both ordinary discovery and the five-file native jobs lane.
// TODO(handoff): HDS-05 remains pending; do not run without separate backend-loss authorization. See meta proposals/2026-09-08-platform-qc-remediation.md.
import { spawn } from 'node:child_process';
import { it, expect } from 'vitest';
if (process.env.MINION_QC_STOCK_BACKEND_FAULTS !== '1') {
  throw new Error('Separate MINION_QC_STOCK_BACKEND_FAULTS=1 admission required');
}
const { stockNativeFaultContext } = await import('./job-stock-concurrency.sql.integration.test');
it('isolates a killed submission backend and verifies committed draft rollback/retry from a new process', async () => {
  const { owner, b, connection, deferred, until, schema, blocked, counts, issue, ORG } =
    stockNativeFaultContext;
  const hold = await connection();
  const locked = deferred<void>();
  const release = deferred<void>();
  const blocker = hold.begin(async (tx) => {
    await tx`SELECT item_id FROM stk_bins WHERE org_id=${ORG} FOR UPDATE`;
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  const child = spawn(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.disposable.config.ts',
      'src/server/services/job-stock-concurrency.sql.integration.test.ts',
      '--testNamePattern=disposable crash child',
      '--maxWorkers=1',
      '--fileParallelism=false',
    ],
    {
      cwd: process.cwd(),
      timeout: 40_000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        MINION_QC_DISPOSABLE: '1',
        MINION_QC_DATABASE_URL: process.env.MINION_QC_DATABASE_URL,
        MINION_QC_CRASH_CHILD_SCHEMA: schema,
      },
    },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-100_000);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-100_000);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  let childPid = 0;
  let draftId: string | undefined;
  try {
    await until(async () => {
      if (child.exitCode !== null)
        throw new Error(`Crash child exited before admission: ${output}`);
      childPid = (await owner`SELECT pid FROM qc_crash_process`)[0]?.pid ?? 0;
      return childPid > 0 && (await blocked(childPid));
    }, 30_000);
    const [draft] = await owner`SELECT id,status FROM stk_entries`;
    draftId = draft.id;
    expect(draft.status).toBe('draft');
    // PID came from this suite's marked child fixture, never an application pool.
    expect(
      (await owner`SELECT pg_terminate_backend(${childPid}) AS terminated`)[0].terminated,
    ).toBe(true);
    expect(await exited).toBe(1);
    expect(output).toContain('disposable crash child');
    // TODO(handoff): Qualify/fix postgres-js nextWrite null-socket crash on backend loss before rollout. See meta proposals/2026-09-08-platform-qc-remediation.md (HDS-05).
    expect(output).toContain('nextWrite');
    expect(output).toContain("Cannot read properties of null (reading 'write')");
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    release.resolve();
    await blocker;
    await exited;
  }
  expect(await counts()).toEqual({ entries: 1, ledger: 0, qty: '10' });
  const resumed = await issue(b);
  expect(resumed.id).toBe(draftId);
  expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
}, 50_000);
