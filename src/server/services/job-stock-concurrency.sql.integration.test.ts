import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openDisposablePostgres,
  validateDisposableDatabaseUrl,
} from '../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({ pool: vi.fn(), audit: vi.fn(), provider: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
vi.mock('./activity.service', () => ({ recordAudit: boundary.audit }));
vi.mock('./notif.service', () => ({ registerNotifCandidateSource: vi.fn() }));
vi.mock('./naming-series', () => ({ nextSerialId: async () => 'STE-NATIVE-FIXTURE' }));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: boundary.provider }));
import { getCoreDb } from '$server/db/pg-client';
import {
  advanceJob,
  cancelJobsByRef,
  enqueueJob,
  registerJobHandler,
  type AdvanceResult,
  type JobExecution,
} from './bg-runtime';
import { createIssueFromInvoice, updateEntry, deleteEntry } from './stock.service';
import { createGroupchatRun } from './groupchat.service';

type Client = ReturnType<typeof postgres>;
const clients = new AsyncLocalStorage<Client>();
const pendingTasks = new Set<Promise<unknown>>();
const releaseOnFailure = new Set<() => void>();
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: Client;
let a: Client;
let b: Client;
let pidA: number;
let pidB: number;
const crashChildSchema = process.env.MINION_QC_CRASH_CHILD_SCHEMA;
if (crashChildSchema && !/^qc_job_stock_[a-f0-9]{32}$/.test(crashChildSchema))
  throw new Error('Invalid disposable child schema');
const schema = crashChildSchema ?? `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`;
const ORG = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const INVOICE = '20000000-0000-4000-8000-abcdef000001';
const ITEM = '30000000-0000-4000-8000-000000000001';
const WH = '40000000-0000-4000-8000-000000000001';
const input = {
  invoiceId: INVOICE,
  warehouseId: WH,
  lines: [{ itemId: ITEM, qty: 2 }],
  submit: true,
  actor: { id: null, name: null },
};
const stockTables = [
  'fin_invoices',
  'stk_items',
  'stk_warehouses',
  'stk_entries',
  'stk_entry_lines',
  'stk_ledger',
  'stk_bins',
];
const fixtureDdl = `
CREATE TABLE qc_crash_process (pid integer NOT NULL);
CREATE TABLE bg_jobs (id text PRIMARY KEY, tenant_id text NOT NULL, user_id text, type text NOT NULL,
  ref_id text, status text NOT NULL DEFAULT 'queued', cursor text, error text, attempts integer NOT NULL DEFAULT 0,
  lease_until bigint, created_at bigint NOT NULL, updated_at bigint NOT NULL, started_at bigint, finished_at bigint);
CREATE TABLE fin_invoices (id uuid PRIMARY KEY, org_id text NOT NULL, provider_ref text);
CREATE TABLE stk_items (id uuid PRIMARY KEY, org_id text NOT NULL, units_per_stock_uom numeric);
CREATE TABLE stk_warehouses (id uuid PRIMARY KEY, org_id text NOT NULL);
CREATE TABLE stk_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
  human_id text, type text NOT NULL, status text NOT NULL DEFAULT 'draft', party_id uuid, note text,
  posted_at timestamptz, created_by text, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stk_entry_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
  entry_id uuid NOT NULL REFERENCES stk_entries, item_id uuid NOT NULL, qty numeric NOT NULL, uom text,
  rate numeric, from_warehouse_id uuid, to_warehouse_id uuid, line_no integer NOT NULL DEFAULT 0);
CREATE TABLE stk_ledger (id bigserial PRIMARY KEY, org_id text NOT NULL, item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL, entry_id uuid NOT NULL, qty_delta numeric NOT NULL, qty_after numeric NOT NULL,
  valuation_rate numeric NOT NULL, value_delta numeric NOT NULL, posted_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stk_bins (org_id text NOT NULL, item_id uuid NOT NULL, warehouse_id uuid NOT NULL,
  qty numeric NOT NULL, valuation_rate numeric NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,item_id,warehouse_id));
CREATE TABLE workshop_groupchat_runs (id text PRIMARY KEY, tenant_id text NOT NULL, server_id text,
  user_id text, prompt text NOT NULL, status text NOT NULL DEFAULT 'draft', rounds integer, style text,
  include_orchestrator boolean NOT NULL DEFAULT false, background boolean NOT NULL DEFAULT false,
  settings text, current_round integer NOT NULL DEFAULT 0, created_at bigint NOT NULL, finished_at bigint);
CREATE TABLE workshop_groupchat_agents (id text PRIMARY KEY, run_id text NOT NULL, name text NOT NULL,
  system_prompt text NOT NULL, provider text NOT NULL, model_id text NOT NULL, order_index integer NOT NULL DEFAULT 0);
CREATE TABLE workshop_groupchat_messages (id text PRIMARY KEY, run_id text NOT NULL, agent_id text,
  round integer NOT NULL, role text NOT NULL, content text NOT NULL, model_id text, latency_ms integer,
  tokens integer, cost_usd double precision, created_at bigint NOT NULL);`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  releaseOnFailure.add(() => resolve(undefined as T));
  return { promise, resolve, reject };
}
async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Native fixture did not reach the required concurrency boundary');
}
const on = <T>(client: Client, fn: () => Promise<T>) => {
  const task = clients.run(client, fn);
  pendingTasks.add(task);
  void task.then(
    () => pendingTasks.delete(task),
    () => pendingTasks.delete(task),
  );
  return task;
};
const issue = (client: Client, tenantId = ORG, request = input) =>
  on(client, () => createIssueFromInvoice({ tenantId, db: getCoreDb() }, request));
async function counts() {
  const [row] = await owner`SELECT (SELECT count(*)::int FROM stk_entries) AS entries,
    (SELECT count(*)::int FROM stk_ledger) AS ledger,
    (SELECT qty::text FROM stk_bins WHERE org_id=${ORG}) AS qty`;
  return row;
}
async function job(id: string) {
  return (await owner`SELECT * FROM bg_jobs WHERE id=${id}`)[0];
}
async function blocked(pid: number) {
  return (
    (await owner`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`)[0]
      ?.wait_event_type === 'Lock'
  );
}
async function connection() {
  return harness.createConnection(schema);
}

beforeAll(async () => {
  // No loadEnv, normal application URL, or runIf: missing identity is a failure.
  harness = await openDisposablePostgres();
  owner = harness.owner;
  if (crashChildSchema) {
    const [identity] = await owner`SELECT obj_description(oid,'pg_namespace') AS marker
      FROM pg_namespace WHERE nspname=${schema}`;
    if (identity?.marker !== `minion-360-fixture:${schema}`)
      throw new Error('Disposable child schema marker mismatch');
    await owner.unsafe(`SET search_path TO "${schema}"`);
  } else {
    await owner.unsafe(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"; ${fixtureDdl}`);
    for (const filename of [
      '20260909090100_bg_job_lease_generation.sql',
      '20260909090200_stock_invoice_issue_identity.sql',
    ]) {
      const source = readFileSync(
        new URL(`../../../supabase/migrations/${filename}`, import.meta.url),
        'utf8',
      );
      await owner.unsafe(source.replaceAll('public.', `"${schema}".`));
    }
    await owner.unsafe(`GRANT USAGE ON SCHEMA "${schema}" TO app_ledger;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO app_ledger;
    REVOKE UPDATE, DELETE ON stk_ledger FROM app_ledger;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA "${schema}" TO app_ledger;`);
    for (const table of stockTables) {
      await owner.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fixture_org ON ${table} TO app_ledger
      USING (org_id = current_setting('app.current_org_id', true))
      WITH CHECK (org_id = current_setting('app.current_org_id', true));`);
    }
    await owner.unsafe(`COMMENT ON SCHEMA "${schema}" IS 'minion-360-fixture:${schema}'`);
  }
  owner = await connection();
  a = await connection();
  b = await connection();
  pidA = (await a`SELECT pg_backend_pid() AS pid`)[0].pid;
  pidB = (await b`SELECT pg_backend_pid() AS pid`)[0].pid;
  boundary.pool.mockImplementation(() => {
    const client = clients.getStore();
    if (!client) throw new Error('No explicitly selected disposable client');
    return client;
  });
  console.info('disposable PostgreSQL receipt', {
    ...harness.identity,
    schema,
    schemaSha256: createHash('sha256').update(fixtureDdl).digest('hex'),
    pidA,
    pidB,
  });
}, 30_000);
beforeEach(async () => {
  if (crashChildSchema) return;
  pidA = (await a`SELECT pg_backend_pid() AS pid`)[0].pid;
  pidB = (await b`SELECT pg_backend_pid() AS pid`)[0].pid;
  boundary.audit.mockReset();
  boundary.provider.mockReset();
  await owner.unsafe(`TRUNCATE ${stockTables.join(',')}, qc_crash_process, bg_jobs, workshop_groupchat_runs,
    workshop_groupchat_agents, workshop_groupchat_messages CASCADE`);
  await owner`INSERT INTO fin_invoices VALUES (${INVOICE}, ${ORG}, 'synthetic-invoice')`;
  await owner`INSERT INTO stk_items VALUES (${ITEM}, ${ORG}, 10)`;
  await owner`INSERT INTO stk_warehouses VALUES (${WH}, ${ORG})`;
  await owner`INSERT INTO stk_bins (org_id,item_id,warehouse_id,qty,valuation_rate)
    VALUES (${ORG}, ${ITEM}, ${WH}, 10, 5)`;
});
afterEach(async () => {
  for (const release of releaseOnFailure) release();
  releaseOnFailure.clear();
  await Promise.allSettled([...pendingTasks]);
});
afterAll(async () => {
  if (owner && !crashChildSchema) await owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await harness?.close();
});

if (crashChildSchema) {
  it('disposable crash child', async () => {
    await owner`INSERT INTO qc_crash_process (pid) VALUES (${pidA})`;
    await issue(a);
    throw new Error('Crash child unexpectedly completed submission');
  }, 15_000);
} else {
  describe('identified disposable PostgreSQL safety', () => {
    it('requires explicit opt-in and rejects nonfixture URLs before connection', () => {
      expect(() => validateDisposableDatabaseUrl(undefined, '1')).toThrow();
      for (const [url, enabled] of [
        ['postgres://minion_qc@127.0.0.1:55439/minion_qc_jobs_stock', '0'],
        ['postgres://minion_qc@db.production.invalid:5432/minion_qc_jobs_stock', '1'],
        ['postgres://minion_qc@127.0.0.1:55439/postgres', '1'],
        ['postgres://minion_qc@127.0.0.1:55439/minion_qc_jobs_stock?host=remote', '1'],
      ])
        expect(() => validateDisposableDatabaseUrl(url, enabled)).toThrow();
    });
    it('rejects the explicitly provisioned unmarked database', async () => {
      const url = validateDisposableDatabaseUrl(
        process.env.MINION_QC_DATABASE_URL,
        process.env.MINION_QC_DISPOSABLE,
      );
      url.pathname = '/minion_qc_unmarked';
      await expect(
        openDisposablePostgres({ MINION_QC_DISPOSABLE: '1', MINION_QC_DATABASE_URL: url.href }),
      ).rejects.toThrow('identity');
    });
    it('uses separate backends and a non-bypass stock role', async () => {
      expect(pidA).not.toBe(pidB);
      expect(
        (await owner`SELECT rolbypassrls FROM pg_roles WHERE rolname='app_ledger'`)[0].rolbypassrls,
      ).toBe(false);
      expect(
        (await owner`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`)[0].n,
      ).toBe(0);
    });
    it('rejects injected fixture schema names before connection and preserves schema on idle reconnect', async () => {
      for (const name of [
        'public',
        'qc_job_stock_bad;DROP TABLE x',
        'qc_job_stock_' + 'g'.repeat(32),
      ])
        expect(() => harness.createConnection(name)).toThrow('schema');
      const idle = await connection();
      const [before] = await idle`SELECT current_schema() AS schema,pg_backend_pid() AS pid`;
      await new Promise((resolve) => setTimeout(resolve, 6000));
      const [after] = await idle`SELECT current_schema() AS schema,pg_backend_pid() AS pid`;
      expect(after.schema).toBe(schema);
      expect(before.schema).toBe(schema);
      expect(after.pid).not.toBe(before.pid);
    }, 15_000);
  });

  describe('native job ownership races', () => {
    it.each(['done', 'error', 'progress'] as const)(
      'rejects late owner %s after another backend claims',
      async (outcome) => {
        const old = deferred<AdvanceResult>();
        const current = deferred<AdvanceResult>();
        let calls = 0;
        const keys: string[] = [];
        registerJobHandler({
          type: 'native-race',
          advance: (_job, execution) => {
            keys.push(execution.effectKey('same-logical-step'));
            return ++calls === 1 ? old.promise : current.promise;
          },
        });
        const id = await on(a, () =>
          enqueueJob({ tenantId: ORG, type: 'native-race', refId: 'fixture' }),
        );
        const first = on(a, () => advanceJob(id));
        await until(() => calls === 1);
        await owner`UPDATE bg_jobs SET lease_until=0 WHERE id=${id}`;
        const second = on(b, () => advanceJob(id));
        await until(() => calls === 2);
        expect(keys[0]).toBe(keys[1]);
        if (outcome === 'error') old.reject(new Error('late owner'));
        else old.resolve({ done: outcome === 'done', cursor: { stale: true } });
        await first;
        expect(await job(id)).toMatchObject({
          status: 'running',
          lease_generation: 2,
          cursor: null,
        });
        current.resolve({ done: true });
        await second;
        expect(await job(id)).toMatchObject({ status: 'done', lease_generation: 2 });
      },
    );
    it('cancellation wins over an in-flight progress result', async () => {
      const output = deferred<AdvanceResult>();
      let started = false;
      registerJobHandler({
        type: 'native-cancel',
        advance: async () => {
          started = true;
          return output.promise;
        },
      });
      const id = await on(a, () =>
        enqueueJob({ tenantId: ORG, type: 'native-cancel', refId: 'cancel-fixture' }),
      );
      const advancing = on(a, () => advanceJob(id));
      await until(() => started);
      await on(b, () => cancelJobsByRef('cancel-fixture'));
      output.resolve({ done: false, cursor: { late: true } });
      await advancing;
      expect(await job(id)).toMatchObject({
        status: 'cancelled',
        cursor: null,
        lease_generation: 2,
      });
    });
    it('rechecks lease expiry after waiting for the ownership row lock', async () => {
      const admitted = deferred<JobExecution>();
      const resume = deferred<void>();
      let effects = 0;
      registerJobHandler({
        type: 'native-admission',
        advance: async (_job, execution) => {
          admitted.resolve(execution);
          await resume.promise;
          await execution.withOwnership(async () => {
            effects++;
          });
          return { done: true };
        },
      });
      const id = await on(a, () => enqueueJob({ tenantId: ORG, type: 'native-admission' }));
      const advancing = on(a, () => advanceJob(id));
      await admitted.promise;
      const locked = deferred<void>();
      const release = deferred<void>();
      const blocker = b.begin(async (tx) => {
        await tx`SELECT id FROM bg_jobs WHERE id=${id} FOR UPDATE`;
        await tx`UPDATE bg_jobs SET lease_until=0 WHERE id=${id}`;
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      resume.resolve();
      await until(() => blocked(pidA));
      release.resolve();
      await blocker;
      await advancing;
      expect(effects).toBe(0);
    });
  });

  describe('native stock transaction races and connection loss', () => {
    it.each(['edit', 'delete'] as const)(
      'rejects a concurrent draft %s after submission acquires the entry lock',
      async (action) => {
        const draft = await issue(a, ORG, { ...input, submit: false });
        const hold = await connection();
        const locked = deferred<void>();
        const release = deferred<void>();
        const blocker = hold.begin(async (tx) => {
          await tx`SELECT item_id FROM stk_bins WHERE org_id=${ORG} FOR UPDATE`;
          locked.resolve();
          await release.promise;
        });
        await locked.promise;
        const submitting = issue(a);
        await until(() => blocked(pidA));
        const editing = on<unknown>(b, () =>
          action === 'edit'
            ? updateEntry({ tenantId: ORG, db: getCoreDb() }, draft.id, {
                lines: [{ itemId: ITEM, qty: 9, fromWarehouseId: WH }],
              })
            : deleteEntry({ tenantId: ORG, db: getCoreDb() }, draft.id),
        );
        const rejection = expect(editing).rejects.toMatchObject({ code: 'not_draft' });
        await until(() => blocked(pidB));
        release.resolve();
        await blocker;
        await submitting;
        await rejection;
        expect((await owner`SELECT qty::text AS qty FROM stk_entry_lines`)[0]).toEqual({
          qty: '2',
        });
        expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
      },
    );
    it('two callers blocked on the actual invoice row converge on one posted entry', async () => {
      const hold = await connection();
      const locked = deferred<void>();
      const release = deferred<void>();
      const blocker = hold.begin(async (tx) => {
        await tx`SELECT id FROM fin_invoices WHERE id=${INVOICE} FOR UPDATE`;
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      const first = issue(a);
      const second = issue(b);
      await until(async () => (await blocked(pidA)) && (await blocked(pidB)));
      release.resolve();
      await blocker;
      const [one, two] = await Promise.all([first, second]);
      expect(one.id).toBe(two.id);
      expect(one.status).toBe('submitted');
      expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
    });
    it('tenant B cannot use tenant A invoice or stock rows', async () => {
      await expect(issue(b, OTHER)).rejects.toMatchObject({ code: 'invoice_not_found' });
      expect(await counts()).toEqual({ entries: 0, ledger: 0, qty: '10' });
    });
    it('resumes the committed draft from another backend without another entry', async () => {
      const draft = await issue(a, ORG, { ...input, submit: false });
      const resumed = await issue(b);
      expect(resumed.id).toBe(draft.id);
      expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
    });
    it('survives post-ledger-commit response loss and retries on another backend', async () => {
      boundary.audit.mockRejectedValueOnce(
        new Error('synthetic lost response after committed transaction'),
      );
      await expect(issue(a)).rejects.toThrow('lost response');
      const before = await owner`SELECT * FROM stk_ledger ORDER BY id`;
      await issue(b);
      expect(await owner`SELECT * FROM stk_ledger ORDER BY id`).toEqual(before);
      expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
    });
    it('isolates a killed submission backend and verifies committed draft rollback/retry from a new process', async () => {
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
  });

  describe('native groupchat admission and message persistence', () => {
    async function groupchat(includeOrchestrator = false) {
      return on(a, async () => {
        const runId = await createGroupchatRun({
          tenantId: ORG,
          prompt: 'Synthetic',
          rounds: 1,
          style: 'freeform',
          includeOrchestrator,
          background: true,
          agents: [
            { name: 'Fixture', systemPrompt: 'Synthetic', provider: 'fake', modelId: 'fake' },
          ],
        });
        return {
          runId,
          jobId: await enqueueJob({ tenantId: ORG, type: 'groupchat', refId: runId }),
        };
      });
    }
    it.each([false, true])(
      'commits run/job terminal atomically (orchestrator=%s)',
      async (orchestrator) => {
        boundary.provider.mockResolvedValue({ text: 'Completed output' });
        const { runId, jobId } = await groupchat(orchestrator);
        await owner.unsafe(`CREATE FUNCTION require_job_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='done' AND NOT EXISTS
        (SELECT 1 FROM bg_jobs WHERE ref_id=NEW.id AND status='done')
      THEN RAISE EXCEPTION 'fixture run/job terminal split'; END IF; RETURN NEW; END $$;
      CREATE CONSTRAINT TRIGGER require_job_terminal AFTER UPDATE ON workshop_groupchat_runs
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_job_terminal();`);
        try {
          await on(a, () => advanceJob(jobId));
          expect(await job(jobId)).toMatchObject({ status: 'done' });
          expect(
            (await owner`SELECT status FROM workshop_groupchat_runs WHERE id=${runId}`)[0].status,
          ).toBe('done');
        } finally {
          await owner.unsafe(
            'DROP TRIGGER require_job_terminal ON workshop_groupchat_runs; DROP FUNCTION require_job_terminal()',
          );
        }
      },
    );
    it('replacement owner never repeats an admitted RPC or persists late output', async () => {
      const output = deferred<{ text: string }>();
      boundary.provider.mockReturnValue(output.promise);
      const { runId, jobId } = await groupchat();
      const first = on(a, () => advanceJob(jobId));
      await until(() => boundary.provider.mock.calls.length === 1);
      const before = JSON.parse((await job(jobId)).cursor);
      await owner`UPDATE bg_jobs SET lease_until=0 WHERE id=${jobId}`;
      await on(b, () => advanceJob(jobId));
      expect(await job(jobId)).toMatchObject({
        status: 'failed',
        lease_generation: 2,
        error: 'groupchat effect outcome indeterminate; reconciliation required',
      });
      output.resolve({ text: 'Late output' });
      await first;
      expect(boundary.provider).toHaveBeenCalledTimes(1);
      expect(
        await owner`SELECT id FROM workshop_groupchat_messages WHERE run_id=${runId}`,
      ).toHaveLength(0);
      expect(JSON.parse((await job(jobId)).cursor).key).toBe(before.key);
      expect(
        (await owner`SELECT status FROM workshop_groupchat_runs WHERE id=${runId}`)[0].status,
      ).toBe('failed');
    });
    it('second job cannot duplicate a remote turn while first owner remains live', async () => {
      const output = deferred<{ text: string }>();
      boundary.provider.mockReturnValue(output.promise);
      const { runId, jobId } = await groupchat();
      const first = on(a, () => advanceJob(jobId));
      await until(() => boundary.provider.mock.calls.length === 1);
      const secondId = await on(b, () =>
        enqueueJob({ tenantId: ORG, type: 'groupchat', refId: runId }),
      );
      await on(b, () => advanceJob(secondId));
      output.resolve({ text: 'One output' });
      await first;
      expect(boundary.provider).toHaveBeenCalledTimes(1);
      expect(
        await owner`SELECT id FROM workshop_groupchat_messages WHERE run_id=${runId}`,
      ).toHaveLength(1);
      expect(await job(jobId)).toMatchObject({ status: 'done' });
    });
    it('committed message survives failed terminal finalization without another model call', async () => {
      boundary.provider.mockResolvedValue({ text: 'Committed output' });
      const { runId, jobId } = await groupchat();
      await owner.unsafe(`CREATE FUNCTION refuse_finish() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='done' THEN RAISE EXCEPTION 'fixture finish response loss'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER refuse_finish BEFORE UPDATE ON bg_jobs FOR EACH ROW EXECUTE FUNCTION refuse_finish();`);
      try {
        await on(a, () => advanceJob(jobId));
        expect(await job(jobId)).toMatchObject({ status: 'failed' });
        expect(
          (await owner`SELECT status FROM workshop_groupchat_runs WHERE id=${runId}`)[0].status,
        ).toBe('failed');
        expect((await job(jobId)).error).toBe(
          'groupchat terminal finalization failed; retry may resume committed effect',
        );
      } finally {
        await owner.unsafe('DROP TRIGGER refuse_finish ON bg_jobs; DROP FUNCTION refuse_finish()');
      }
      const before = await owner`SELECT * FROM workshop_groupchat_messages WHERE run_id=${runId}`;
      expect(before).toHaveLength(1);
      expect(JSON.parse((await job(jobId)).cursor).state).toBe('committed');
      await owner`UPDATE bg_jobs SET status='queued',lease_until=NULL WHERE id=${jobId}`;
      await on(b, () => advanceJob(jobId));
      expect(await owner`SELECT * FROM workshop_groupchat_messages WHERE run_id=${runId}`).toEqual(
        before,
      );
      expect(boundary.provider).toHaveBeenCalledTimes(1);
      expect(await job(jobId)).toMatchObject({ status: 'done' });
    });
    it('rejects a changed config after admission without persisting a different effect', async () => {
      const output = deferred<{ text: string }>();
      boundary.provider.mockReturnValue(output.promise);
      const { runId, jobId } = await groupchat();
      const first = on(a, () => advanceJob(jobId));
      await until(() => boundary.provider.mock.calls.length === 1);
      await owner`UPDATE workshop_groupchat_runs SET prompt='Changed' WHERE id=${runId}`;
      const duplicateId = await on(b, () =>
        enqueueJob({ tenantId: ORG, type: 'groupchat', refId: runId }),
      );
      await on(b, () => advanceJob(duplicateId));
      expect((await job(duplicateId)).status).toBe('failed');
      expect(
        (await owner`SELECT status FROM workshop_groupchat_runs WHERE id=${runId}`)[0].status,
      ).toBe('running');
      output.resolve({ text: 'Output for old prompt' });
      await first;
      expect(await owner`SELECT id FROM workshop_groupchat_messages`).toHaveLength(0);
      expect((await job(jobId)).error).toContain('configuration changed');
      expect(
        (await owner`SELECT status FROM workshop_groupchat_runs WHERE id=${runId}`)[0].status,
      ).toBe('failed');
      expect(boundary.provider).toHaveBeenCalledTimes(1);
    });
  });
}
