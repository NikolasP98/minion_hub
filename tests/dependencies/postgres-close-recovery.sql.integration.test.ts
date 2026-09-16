import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDisposablePostgres } from '../../scripts/qc/disposable-postgres';

const require = createRequire(import.meta.url);
const installedRoot = path.resolve(path.dirname(require.resolve('postgres')), '../..');
const driverRoot = realpathSync(process.env.MINION_QC_POSTGRES_PACKAGE ?? installedRoot);
const manifest = JSON.parse(readFileSync(path.join(driverRoot, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
if (manifest.name !== 'postgres')
  throw new Error('Expected an explicitly selected postgres package');
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
beforeAll(async () => {
  harness = await openDisposablePostgres();
}, 10000);
afterAll(async () => {
  await harness?.close();
});

// A separate process contains the known driver crash. No uncaught-exception or
// unhandled-rejection handler is installed; a watchdog always means test failure.
const childSource = String.raw`
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\n');
const packageRoot = process.env.MINION_QC_POSTGRES_PACKAGE;
const schema = process.env.MINION_QC_DRIVER_SCHEMA;
const mode = process.env.MINION_QC_DRIVER_MODE;
const url = process.env.MINION_QC_DATABASE_URL;
if (process.env.MINION_QC_DISPOSABLE !== '1' || !/^qc_job_stock_[a-f0-9]{32}$/.test(schema ?? '')) throw new Error('Missing explicit child fixture');
const parsed = new URL(url);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', '[::1]'].includes(parsed.hostname) || !parsed.port || parsed.username !== 'minion_qc' || !/^\/minion_qc_[a-z0-9_]+$/.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Invalid child fixture URL');
const loaded = process.env.MINION_QC_DRIVER_ENTRY === 'esm'
  ? await import(pathToFileURL(path.join(packageRoot, 'src/index.js')).href)
  : createRequire(import.meta.url)(path.join(packageRoot, 'cjs/src/index.js'));
const postgres = loaded.default ?? loaded;
const pool = postgres(url, { max: 1, max_pipeline: 1, prepare: false, connect_timeout: 2, idle_timeout: 1,
  connection: { application_name: 'qc-driver-' + schema, search_path: schema + ',pg_catalog', statement_timeout: 10000 } });
const pending = new Set();
const settlements = [];
const track = (name, promise) => {
  pending.add(name);
  return Promise.resolve(promise).then(
    (value) => { pending.delete(name); settlements.push({name, ok:true}); emit({event:'settled',name,ok:true}); return {ok:true,value}; },
    (error) => { pending.delete(name); settlements.push({name,ok:false,code:error.code}); emit({event:'settled',name,ok:false,code:error.code}); return {ok:false}; });
};
const watchdog = setTimeout(() => {
  emit({event:'deadline',pending:[...pending],settlements});
  process.exit(2);
}, 5000);
try {
  const [identity] = await pool.unsafe("SELECT current_database() AS database,current_user AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
  const [schemaIdentity] = await pool.unsafe("SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1", [schema]);
  if (identity.database !== parsed.pathname.slice(1) || identity.owner !== 'minion_qc' || identity.marker !== 'minion-360-disposable:v1' || schemaIdentity?.marker !== 'minion-360-driver:' + schema) throw new Error('Child fixture marker mismatch');
  await pool.unsafe("INSERT INTO driver_effects(id,value) VALUES ('committed',1)");
  let announce;
  const ready = new Promise((resolve) => { announce = resolve; });
  let active, sent, queued, rollback;
  const transaction = track('transaction', pool.begin(async (tx) => {
    await tx.unsafe("INSERT INTO driver_effects(id,value) VALUES ('ambiguous',1)");
    const [{pid}] = await tx.unsafe('SELECT pg_backend_pid() AS pid');
    active = track('active', tx.unsafe("UPDATE driver_effects SET value=value+1 WHERE id='guard'"));
    sent = mode === 'queued' ? track('sent', tx.unsafe('SELECT 2 AS value')) : Promise.resolve({ok:false});
    queued = mode === 'queued' ? track('queued', tx.unsafe('SELECT 3 AS value')) : Promise.resolve({ok:false});
    rollback = active.then((outcome) => {
      if (outcome.ok) throw new Error('Interrupted write unexpectedly succeeded');
      return track('rollback', tx.unsafe('ROLLBACK'));
    });
    announce(pid);
    await Promise.all([active, sent, queued, rollback]);
    throw new Error('Synthetic aborted transaction');
  }));
  const pid = await ready;
  const poolWaiter = track('pool waiter', pool.unsafe('SELECT 4 AS value'));
  emit({event:'ready',pid});
  const [transactionResult, activeResult, sentResult, queuedResult, rollbackResult, waiterResult] =
    await Promise.all([transaction, active, sent, queued, rollback, poolWaiter]);
  if (transactionResult.ok || activeResult.ok || sentResult.ok || queuedResult.ok) throw new Error('Lost transaction work was replayed or reported successful');
  if (!waiterResult.ok) throw new Error('Queued pool caller did not recover');
  const healthy = await track('reuse', pool.unsafe('SELECT 42 AS value,pg_backend_pid() AS pid'));
  if (!healthy.ok || healthy.value[0].value !== 42 || healthy.value[0].pid === pid) throw new Error('Pool reuse did not establish a healthy replacement');
  await track('close', pool.end({timeout:2}));
  emit({event:'complete',pending:[...pending],settlements,rollbackSettled:!!rollbackResult});
} finally {
  clearTimeout(watchdog);
  await pool.end({timeout:1});
}
`;

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('postgres backend-loss caller settlement', () => {
  it.each([
    { entry: 'esm', mode: 'rollback' },
    { entry: 'esm', mode: 'queued' },
    { entry: 'cjs', mode: 'rollback' },
    { entry: 'cjs', mode: 'queued' },
  ])(
    'settles $mode callers and reuses the $entry pool',
    async ({ entry, mode }) => {
      const schema = `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`;
      const owner = harness.owner;
      await owner.unsafe(`CREATE SCHEMA "${schema}";
      COMMENT ON SCHEMA "${schema}" IS 'minion-360-driver:${schema}';
      CREATE TABLE "${schema}".driver_effects(id text PRIMARY KEY,value integer NOT NULL);
      INSERT INTO "${schema}".driver_effects VALUES ('guard',0);`);
      const hold = harness.createConnection(schema);
      let unlock!: () => void;
      let locked!: () => void;
      const lockEntered = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const blocker = hold.begin(async (tx) => {
        await tx`SELECT * FROM driver_effects WHERE id='guard' FOR UPDATE`;
        locked();
        await release;
      });
      await lockEntered;
      const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
        cwd: process.cwd(),
        timeout: 12000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          MINION_QC_DISPOSABLE: '1',
          MINION_QC_DATABASE_URL: process.env.MINION_QC_DATABASE_URL,
          MINION_QC_DRIVER_SCHEMA: schema,
          MINION_QC_DRIVER_ENTRY: entry,
          MINION_QC_DRIVER_MODE: mode,
          MINION_QC_POSTGRES_PACKAGE: driverRoot,
        },
      });
      let output = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-100000);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-100000);
      });
      const exited = new Promise<number | null>((resolve, reject) => {
        child.on('exit', resolve);
        child.on('error', reject);
      });
      try {
        let pid: number | undefined;
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          if (child.exitCode !== null)
            throw new Error(`Driver child exited before fault admission: ${output}\n${stderr}`);
          const readyLine = output.split('\n').find((line) => line.includes('"event":"ready"'));
          if (readyLine) pid = (JSON.parse(readyLine) as { pid: number }).pid;
          if (pid) {
            const [activity] =
              await owner`SELECT wait_event_type,application_name FROM pg_stat_activity WHERE pid=${pid}`;
            if (
              activity?.wait_event_type === 'Lock' &&
              activity.application_name === `qc-driver-${schema}`
            )
              break;
          }
          await delay(10);
        }
        expect(pid, `No owned blocked child PID: ${output}\n${stderr}`).toBeTypeOf('number');
        const [activity] =
          await owner`SELECT wait_event_type,application_name FROM pg_stat_activity WHERE pid=${pid!}`;
        expect(activity).toEqual({
          wait_event_type: 'Lock',
          application_name: `qc-driver-${schema}`,
        });
        expect((await owner`SELECT pg_terminate_backend(${pid!}) AS killed`)[0].killed).toBe(true);
        const code = await exited;
        console.info('driver fault receipt', {
          entry,
          mode,
          version: manifest.version,
          node: process.version,
          pg: harness.identity.version,
          sourceSha256: createHash('sha256')
            .update(
              readFileSync(
                path.join(
                  driverRoot,
                  entry === 'esm' ? 'src/connection.js' : 'cjs/src/connection.js',
                ),
              ),
            )
            .digest('hex'),
          code,
          output,
          stderr,
        });
        expect(
          await owner.unsafe(`SELECT id,value FROM "${schema}".driver_effects ORDER BY id`),
        ).toEqual([
          { id: 'committed', value: 1 },
          { id: 'guard', value: 0 },
        ]);
        expect(code, `Driver must settle, close and exit normally:\n${output}\n${stderr}`).toBe(0);
        expect(stderr).not.toMatch(/TypeError|Unhandled|uncaught/i);
        const complete = output.split('\n').find((line) => line.includes('"event":"complete"'));
        expect(complete, output).toBeDefined();
        expect((JSON.parse(complete!) as { pending: unknown[] }).pending).toEqual([]);
      } finally {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
          await exited;
        }
        unlock();
        await blocker;
        await owner.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      }
    },
    20000,
  );
});
