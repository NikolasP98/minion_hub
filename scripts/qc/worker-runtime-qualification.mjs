/** Bare adapter-node lifecycle qualification against an operator-created disposable fixture.
 * Usage: MINION_QC_DISPOSABLE=1 MINION_QC_DATABASE_URL=postgres://... \
 * node scripts/qc/worker-runtime-qualification.mjs /absolute/artifact /absolute/receipt.json
 * Fixture needs the captured empty gateway schema and bg_jobs, with no queued work.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import postgres from 'postgres';

const [artifactArg, receiptArg] = process.argv.slice(2);
assert.ok(artifactArg && receiptArg, 'Artifact directory and receipt path are required');
const artifact = path.resolve(artifactArg);
const receiptPath = path.resolve(receiptArg);
const databaseUrl = process.env.MINION_QC_DATABASE_URL;
assert.equal(process.env.MINION_QC_DISPOSABLE, '1', 'Explicit disposable opt-in required');
assert.ok(databaseUrl, 'Explicit disposable database URL required');
const target = new URL(databaseUrl);
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.username, 'minion_qc');
assert.equal(target.pathname, '/minion_qc_worker');
assert.notEqual(target.port, '5432', 'Use a dedicated private fixture port');
const db = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 3 });
try {
  const [identity] = await db`select current_database() as db, current_user as owner,
    host(inet_server_addr()) as address, shobj_description(oid,'pg_database') as marker
    from pg_database where datname=current_database()`;
  assert.deepEqual(identity, {
    db: 'minion_qc_worker',
    owner: 'minion_qc',
    address: '127.0.0.1',
    marker: 'minion-360-disposable:v1',
  });
  const [{ count }] =
    await db`select count(*)::int as count from public.bg_jobs where status in ('queued','running')`;
  assert.equal(count, 0, 'Bare probe requires no runnable fixture jobs');
} finally {
  await db.end();
}
const port = Number(process.env.MINION_QC_WORKER_PORT ?? '55466');
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const log = fs.openSync(`${receiptPath}.process.log`, 'w', 0o600);
const child = spawn(process.execPath, [path.join(artifact, 'build/index.js')], {
  cwd: artifact,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'production',
    DESKTOP: '1',
    HOST: '127.0.0.1',
    PORT: String(port),
    ORIGIN: `http://127.0.0.1:${port}`,
    SUPABASE_DB_URL: databaseUrl,
    SUPABASE_DB_POOL_SIZE: '2',
    SUPABASE_DB_RLS_POOL_SIZE: '2',
    CRON_SECRET: 'owned-disposable-worker-probe',
    PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1',
    PUBLIC_SUPABASE_ANON_KEY: 'no-provider',
    CACHE_BACKEND: 'noop',
    TURSO_DB_URL: `file:${receiptPath}.sqlite`,
  },
  stdio: ['ignore', log, log],
});
fs.closeSync(log);
const receipt = { artifact, pid: child.pid, preload: false, ipc: false, success: false };
const save = () =>
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
let exit;
child.once('exit', (code, signal) => {
  exit = { code, signal, time: Date.now() };
  receipt.exit = exit;
  save();
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let ready = false;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !exit) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/jobs/tick`, {
        headers: { connection: 'close' },
        signal: AbortSignal.timeout(1000),
      });
      ready = response.status === 401;
      if (ready) break;
    } catch {
      /* Bounded boot readiness. */
    }
    await sleep(50);
  }
  assert.ok(ready, 'Unauthorized cron readiness must return401');
  const authorized = await fetch(`http://127.0.0.1:${port}/api/jobs/tick`, {
    headers: { authorization: 'Bearer owned-disposable-worker-probe', connection: 'close' },
    signal: AbortSignal.timeout(5000),
  });
  await authorized.text();
  assert.equal(authorized.status, 200);
  receipt.signalAt = Date.now();
  child.kill('SIGTERM');
  const stopDeadline = Date.now() + 15_000;
  while (!exit && Date.now() < stopDeadline) await sleep(50);
  assert.equal(exit?.code, 0, 'Worker must exit naturally within15s; no forced termination');
  receipt.elapsedMs = exit.time - receipt.signalAt;
  receipt.success = true;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (!exit && !receipt.signalAt) child.kill('SIGTERM');
  save();
}
// Keep the owned child alive for diagnosis if graceful shutdown does not complete.
