/** Executes actual compiled adapter-node artifacts against an explicitly marked disposable
 * PostgreSQL child. No provider, authenticated account or production database is used.
 * Run with MINION_QC_DISPOSABLE=1 and the disposable POSTGRES URL contract from
 * scripts/qc/disposable-postgres.ts. Exit failure is evidence of a failed assertion. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  setupNotificationSchedulerHarness,
  teardownNotificationSchedulerHarness,
} from '../fixtures/notification-scheduler/postgres-harness';
import { OUTBOX_ORG_A } from '../fixtures/notification-outbox/postgres-harness';

const { values } = parseArgs({
  options: {
    qualified: { type: 'string' },
    production: { type: 'string' },
    output: { type: 'string' },
  },
});
if (!values.qualified || !values.production || !values.output)
  throw new Error('Require --qualified, --production and --output directory paths');
const artifacts = { qualified: resolve(values.qualified), production: resolve(values.production) };
for (const artifact of Object.values(artifacts))
  if (!statSync(join(artifact, 'index.js')).isFile())
    throw new Error('Missing compiled adapter-node entry');
const output = resolve(values.output);
// A new owned evidence directory prevents overwriting a previous qualification receipt.
mkdirSync(output);
// This runner uses Bun for TypeScript. Resolve Node itself once, then execute
// every compiled artifact with that absolute binary and production environment.
const nodeBinary = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
const nodeVersion = execFileSync(nodeBinary, ['--version'], { encoding: 'utf8' }).trim();
const harness = await setupNotificationSchedulerHarness();
const observations: unknown[] = [];
const processes: OwnedProcess[] = [];
type OwnedProcess = {
  name: string;
  child: ChildProcess;
  log: string;
  exit: Promise<{ code: number | null; signal: string | null }>;
  settled: boolean;
  fault: Error | null;
};
function record(value: unknown) {
  observations.push(value);
  console.log(JSON.stringify(value));
}
async function until(
  predicate: () => Promise<boolean> | boolean,
  label: string,
  limit = 20000,
  checkProcessFaults = true,
) {
  const end = performance.now() + limit;
  while (!(await predicate())) {
    if (checkProcessFaults) {
      const failed = processes.find((p) => p.fault);
      if (failed) throw failed.fault;
    }
    if (performance.now() >= end) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
function start(
  name: string,
  port: number,
  extras: Record<string, string> = {},
  artifact: keyof typeof artifacts = 'qualified',
): OwnedProcess {
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'LANG', 'TMPDIR'].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]!]] : [],
    ),
  );
  Object.assign(env, {
    DESKTOP: '1',
    NODE_ENV: 'production',
    PGAPPNAME: `minion-qc:${name}`,
    NOTIFICATION_WORKER: '1',
    MINION_QC_DISPOSABLE: '1',
    MINION_NOTIFICATION_FIXTURE_OWNER: harness.fixtureOwnerId,
    SUPABASE_DB_URL: harness.childUrl.href,
    SUPABASE_DB_POOL_SIZE: '2',
    SUPABASE_DB_RLS_POOL_SIZE: '2',
    PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1',
    PUBLIC_SUPABASE_ANON_KEY: 'disposable-placeholder',
    HOST: '127.0.0.1',
    PORT: String(port),
    ORIGIN: `http://127.0.0.1:${port}`,
    PUBLIC_POSTHOG_KEY: '',
    PUBLIC_POSTHOG_HOST: 'http://127.0.0.1:1',
    ...extras,
  });
  const child = spawn(nodeBinary, [join(artifacts[artifact], 'index.js')], {
    cwd: artifacts[artifact],
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const owned: OwnedProcess = {
    name,
    child,
    log: '',
    settled: false,
    fault: null,
    exit: Promise.resolve({ code: null, signal: null }),
  };
  const logCap = 2 * 1024 * 1024;
  let logBytes = 0;
  function append(chunk: Buffer) {
    const remaining = Math.max(0, logCap - logBytes);
    owned.log += chunk.subarray(0, remaining).toString();
    logBytes += chunk.length;
    if (logBytes > logCap && !owned.fault) {
      owned.fault = new Error(`Compiled child log exceeded ${logCap} bytes: ${name}`);
      child.kill('SIGTERM');
    }
  }
  child.stdout!.on('data', append);
  child.stderr!.on('data', append);
  owned.exit = new Promise((resolve) => {
    child.once('error', (error) => {
      owned.fault = error;
      owned.settled = true;
      resolve({ code: null, signal: null });
    });
    child.once('exit', (code, signal) => {
      owned.settled = true;
      resolve({ code, signal });
    });
  });
  processes.push(owned);
  return owned;
}
async function stop(owned: OwnedProcess) {
  if (!owned.settled) owned.child.kill('SIGTERM');
  await until(() => owned.settled, `settlement ${owned.name}`, 30000);
  const result = await owned.exit;
  assert.equal(owned.fault, null);
  assert.equal(result.code, 0, owned.log);
  return result;
}
async function runtime() {
  const [row] =
    await harness.owner`select owner_id::text,generation::text,last_heartbeat_at::text,lease_expires_at::text,admission_code,projector_revision from public.notification_worker_runtime`;
  return row;
}
let runFailure: unknown;
let connectionsDisabled = false;
async function setChildConnections(enabled: boolean) {
  assert.match(harness.childName, /^minion_qc_notification_outbox_[a-f0-9]{20}$/);
  await harness.parent.owner.unsafe(
    `ALTER DATABASE "${harness.childName}" ALLOW_CONNECTIONS ${enabled ? 'true' : 'false'}`,
  );
  connectionsDisabled = !enabled;
}
try {
  record({
    case: 'runtime-identity',
    nodeBinary,
    nodeVersion,
    cwd: artifacts,
    nodeEnv: 'production',
  });
  assert.equal((await runtime()).owner_id, null);
  const first = start('leader', 4521);
  await until(async () => Boolean((await runtime()).owner_id), 'first compiled leader');
  const initial = await runtime();
  assert.equal(initial.projector_revision, 'qualification-only.1');
  const second = start('standby-b', 4522);
  const third = start('standby-c', 4523);
  await until(
    () => [first, second, third].every((p) => p.log.includes('Listening on')),
    'three adapter listeners',
  );
  await until(
    async () => (await runtime()).last_heartbeat_at !== initial.last_heartbeat_at,
    'idle heartbeat',
  );
  const live = await runtime();
  assert.equal(live.owner_id, initial.owner_id);
  assert.equal(live.generation, initial.generation);
  const [{ count }] =
    await harness.owner`select count(*)::int as count from public.notification_org_control`;
  assert.equal(count, 0);
  record({
    case: 'three-process-singleton-idle-heartbeat',
    generation: live.generation,
    controlRows: count,
    passed: true,
  });
  await stop(first);
  await until(async () => {
    const r = await runtime();
    return r.owner_id !== null && r.owner_id !== initial.owner_id;
  }, 'standby takeover');
  const takeover = await runtime();
  assert.equal(BigInt(takeover.generation), BigInt(initial.generation) + 1n);
  record({
    case: 'graceful-leader-release-and-takeover',
    generation: takeover.generation,
    passed: true,
  });
  await Promise.all([stop(second), stop(third)]);
  assert.equal((await runtime()).owner_id, null);
  assert.ok(processes.every((p) => p.settled));
  const releasedGeneration = (await runtime()).generation;
  const crashed = start('crashed-leader', 4527);
  await until(async () => Boolean((await runtime()).owner_id), 'crash test leader');
  const beforeCrash = await runtime();
  // This fresh, isolated child database has no other live worker. Correlate the
  // new lease with the sole started process before adding the crash standbys.
  assert.deepEqual(
    processes.filter((p) => !p.settled).map((p) => p.name),
    ['crashed-leader'],
  );
  assert.equal(BigInt(beforeCrash.generation), BigInt(releasedGeneration) + 1n);
  assert.ok(crashed.log.includes('startup-query-finish'));
  const crashStandbyA = start('crash-standby-a', 4528);
  const crashStandbyB = start('crash-standby-b', 4529);
  await until(
    () => [crashStandbyA, crashStandbyB].every((p) => p.log.includes('Listening on')),
    'crash test standby listeners',
  );
  crashed.child.kill('SIGKILL');
  await until(() => crashed.settled, 'crashed leader exits');
  assert.equal((await crashed.exit).signal, 'SIGKILL');
  await until(
    async () => {
      const state = await runtime();
      return state.owner_id !== null && state.owner_id !== beforeCrash.owner_id;
    },
    'single takeover after crash expiry',
    45000,
  );
  const afterCrash = await runtime();
  assert.equal(BigInt(afterCrash.generation), BigInt(beforeCrash.generation) + 1n);
  await new Promise((resolve) => setTimeout(resolve, 5500));
  const steady = await runtime();
  assert.equal(steady.owner_id, afterCrash.owner_id);
  assert.equal(steady.generation, afterCrash.generation);
  record({
    case: 'crashed-leader-single-expiry-takeover',
    generation: steady.generation,
    passed: true,
  });
  await Promise.all([stop(crashStandbyA), stop(crashStandbyB)]);
  assert.equal((await runtime()).owner_id, null);

  const waitingLeader = start('standby-wait-leader', 4530);
  await until(async () => Boolean((await runtime()).owner_id), 'standby wait leader');
  const waitingState = await runtime();
  const waiting = start('standby-wait-stop', 4531);
  await until(() => waiting.log.includes('startup-query-finish'), 'standby admitted');
  await until(async () => {
    // Qualification admission uses the ordinary pool; lease acquisition uses
    // the separate RLS pool. Both committed idle connections prove this process
    // completed the actual busy-lease transaction before receiving the signal.
    const [{ count }] = await harness.owner`select count(*)::int as count
      from pg_stat_activity where datname=${harness.childName}
      and application_name='minion-qc:standby-wait-stop' and state='idle' and lower(trim(query))='commit'`;
    return count >= 2;
  }, 'standby waiting after actual lease admission');
  assert.equal((await runtime()).owner_id, waitingState.owner_id);
  const waitingStopAt = performance.now();
  await stop(waiting);
  const waitingStopMs = performance.now() - waitingStopAt;
  assert.ok(waitingStopMs < 3000, `Standby timer was not cancelled: ${waitingStopMs}`);
  await stop(waitingLeader);
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const afterWaiting = await runtime();
  assert.equal(afterWaiting.owner_id, null);
  assert.equal(afterWaiting.generation, waitingState.generation);
  record({ case: 'standby-wait-shutdown-no-late-acquisition', waitingStopMs, passed: true });

  const outage = start('database-outage-recovery', 4532);
  await until(async () => Boolean((await runtime()).owner_id), 'outage test leader');
  for (let cycle = 1; cycle <= 2; cycle++) {
    const before = await runtime();
    await setChildConnections(false);
    try {
      await harness.parent
        .owner`select pg_terminate_backend(pid) from pg_stat_activity where datname=${harness.childName}`;
      await until(async () => {
        const [{ count }] = await harness.parent
          .owner`select count(*)::int as count from pg_stat_activity where datname=${harness.childName}`;
        return count === 0;
      }, 'owned child connections closed');
      // Cross the real heartbeat period; no database connection can hide the
      // outage behind a warm pool. Parent database remains available for cleanup.
      await new Promise((resolve) => setTimeout(resolve, 6500));
      assert.equal(outage.settled, false);
      const [database] = await harness.parent
        .owner`select datallowconn from pg_database where datname=${harness.childName}`;
      assert.equal(database.datallowconn, false);
    } finally {
      await setChildConnections(true);
    }
    await until(
      async () => {
        const state = await runtime();
        return state.owner_id !== null && BigInt(state.generation) > BigInt(before.generation);
      },
      `database outage recovery ${cycle}`,
      45000,
    );
    const recovered = await runtime();
    assert.equal(BigInt(recovered.generation), BigInt(before.generation) + 1n);
    record({
      case: 'repeated-database-outage-recovery',
      cycle,
      generation: recovered.generation,
      passed: true,
    });
  }
  await stop(outage);
  assert.equal((await runtime()).owner_id, null);

  const cold = start('startup-signal', 4524, {
    MINION_NOTIFICATION_FIXTURE_STARTUP_DELAY_MS: '2500',
  });
  await until(() => cold.log.includes('startup-query-start'), 'startup query entered');
  const startupSignal = performance.now();
  cold.child.kill('SIGTERM');
  await until(() => cold.settled, 'startup drain');
  assert.equal((await cold.exit).code, 0, cold.log);
  const startupElapsed = performance.now() - startupSignal;
  assert.ok(cold.log.includes('startup-query-finish'), cold.log);
  assert.ok(startupElapsed >= 2000, `Startup prematurely drained: ${startupElapsed}`);
  assert.equal((await runtime()).owner_id, null);
  record({
    case: 'signal-during-real-startup-sql',
    elapsedMs: startupElapsed,
    queryFinished: true,
    noLateLease: true,
    passed: true,
  });
  const requestId = '30000000-0000-4000-8000-000000000001';
  const payload = JSON.stringify({
    applicantProfileId: '40000000-0000-4000-8000-000000000001',
    requestId,
  });
  const digest = createHash('sha256').update(payload).digest('hex');
  await harness.source.begin(async (tx) => {
    await tx`select set_config('role','app_ledger',true),set_config('app.current_org_id',${OUTBOX_ORG_A},true)`;
    await tx`insert into public.notification_events(organization_id,kind,schema_version,catalog_revision,producer_id,subject_type,subject_id,subject_revision,source_identity,occurred_at,dedupe_key,payload_canonical,payload_sha256,semantic_sha256)
      values(${OUTBOX_ORG_A}::uuid,'join.requested',1,'2026-10-03.1','membership.join','join_request',${requestId}::uuid,'fixture-1','fixture-1',clock_timestamp(),'compiled-shutdown-fixture',${payload},${digest},repeat('b',64))`;
  });
  const pending = start('noncooperative-projection', 4525, {
    MINION_NOTIFICATION_FIXTURE_DELAY_MS: '9000',
    MINION_NOTIFICATION_FIXTURE_IGNORE_ABORT: '1',
  });
  await until(() => pending.log.includes('projection-start'), 'real compiled projection start');
  const signalAt = performance.now();
  pending.child.kill('SIGTERM');
  await until(() => pending.settled, 'underlying projection drain');
  const pendingElapsed = performance.now() - signalAt;
  const exit = await pending.exit;
  assert.equal(exit.code, 0, pending.log);
  assert.ok(pendingElapsed >= 8000, `Projection prematurely drained: ${pendingElapsed}`);
  assert.ok(pending.log.includes('projection-finish'), pending.log);
  const rows = await harness.owner`select state from public.notification_outbox`;
  assert.deepEqual(
    rows.map((r) => r.state),
    ['pending'],
  );
  assert.equal((await runtime()).owner_id, null);
  record({
    case: 'signal-retains-noncooperative-projection',
    elapsedMs: pendingElapsed,
    actualProjectionFinished: true,
    outboxUntouched: true,
    leaseReleased: true,
    passed: true,
  });
  for (const enabled of [false, true]) {
    const generation = (await runtime()).generation;
    const process = start(
      `production-${enabled ? 'enabled' : 'disabled'}`,
      4526,
      {
        NOTIFICATION_WORKER: enabled ? '1' : '0',
        MINION_NOTIFICATION_QUALIFICATION_BUILD: '1',
        MINION_NOTIFICATION_FIXTURE_IGNORE_ABORT: '1',
      },
      'production',
    );
    await until(() => process.log.includes('Listening on'), 'production adapter start');
    if (enabled)
      await until(
        async () => (await runtime()).admission_code === 'projection_unavailable',
        'production admission unavailable',
      );
    else await new Promise((resolve) => setTimeout(resolve, 1200));
    const [state] =
      await harness.owner`select generation::text,owner_id,admission_generation::text,admission_code,admission_catalog_revision,admission_catalog_sha256,admission_projector_revision,admission_projector_sha256,admission_artifact_sha256 from public.notification_worker_runtime`;
    assert.equal(state.generation, generation);
    assert.equal(state.owner_id, null);
    assert.equal(state.admission_generation, enabled ? '1' : '0');
    assert.equal(state.admission_code, enabled ? 'projection_unavailable' : null);
    if (enabled) {
      assert.equal(state.admission_catalog_revision, '2026-10-03.1');
      assert.match(state.admission_catalog_sha256, /^[a-f0-9]{64}$/);
      assert.equal(state.admission_projector_revision, null);
      assert.equal(state.admission_projector_sha256, null);
      assert.equal(state.admission_artifact_sha256, null);
    }
    assert.ok(!process.log.includes('[notification-qualification]'));
    await stop(process);
    record({
      case: enabled
        ? 'runtime-flags-cannot-enable-qualification-adapter'
        : 'disabled-worker-does-not-admit',
      ...state,
      passed: true,
    });
  }
} catch (error) {
  runFailure = error;
} finally {
  const cleanupErrors: unknown[] = [];
  const cleanup = await Promise.allSettled(
    processes.map(async (p) => {
      if (!p.settled) {
        p.child.kill('SIGTERM');
        try {
          await until(() => p.settled, `cleanup ${p.name}`, 30000, false);
        } catch {
          p.child.kill('SIGKILL');
          await p.exit;
          cleanupErrors.push(new Error(`Required forced cleanup: ${p.name}`));
        }
      }
      if (p.fault) cleanupErrors.push(p.fault);
      writeFileSync(join(output, `${p.name}.log`), p.log);
    }),
  );
  cleanupErrors.push(
    ...cleanup.filter((item) => item.status === 'rejected').map((item) => item.reason),
  );
  let databaseCleaned = false;
  try {
    if (connectionsDisabled) await setChildConnections(true);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await teardownNotificationSchedulerHarness(harness);
    databaseCleaned = true;
  } catch (error) {
    cleanupErrors.push(error);
  }
  record({
    case: 'cleanup',
    childAndOwnedRolesRemoved: databaseCleaned,
    processesSettled: processes.every((p) => p.settled),
    errors: cleanupErrors.length,
    qualificationPassed: !runFailure && cleanupErrors.length === 0,
  });
  writeFileSync(join(output, 'results.json'), JSON.stringify(observations, null, 2) + '\n');
  if (runFailure || cleanupErrors.length)
    throw new AggregateError(
      [...(runFailure ? [runFailure] : []), ...cleanupErrors],
      'Compiled notification qualification failed',
    );
}
