import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const secret = 'fixture-scheduled-pulse-secret';
async function start(extra = {}) {
  const child = spawn(process.execPath, ['scripts/qc/pulse-digest-scheduler-child.mjs'], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      TURSO_DB_URL: 'file::memory:',
      OPENROUTER_API_KEY: 'local-fixture-no-paid-access',
      MINION_QC_DISPOSABLE: process.env.MINION_QC_DISPOSABLE,
      MINION_QC_DATABASE_URL: process.env.MINION_QC_DATABASE_URL,
      CRON_SECRET: secret,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('scheduler fixture startup timeout'));
    }, 20000);
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      for (const line of output.split('\n')) {
        try {
          const result = JSON.parse(line);
          if (result.ready) {
            clearTimeout(timer);
            resolve(result);
          }
        } catch {}
      }
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`scheduler fixture exited ${code}: ${output}`));
    });
  });
  return {
    child,
    ...ready,
    stop: () =>
      new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill('SIGTERM');
      }),
  };
}
async function invoke(origin, credential = secret) {
  const child = spawn('bash', ['scripts/ops/pulse-tick.sh'], {
    env: {
      PATH: process.env.PATH,
      CRON_SECRET: credential,
      MINION_PULSE_TICK_URL: origin + '/api/pulse/tick',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (c) => {
    output += String(c);
  });
  child.stderr.on('data', (c) => {
    output += String(c);
  });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  return { code, output };
}
test(
  'actual minute schedule script collects from empty queue and survives restart and duplicate ticks with exactly one card',
  { timeout: 90000 },
  async () => {
    assert.match(
      readFileSync('deploy/pulse-tick.cron.example', 'utf8'),
      /^\* \* \* \* \* \/opt\/minion-hub\/scripts\/ops\/pulse-tick.sh$/m,
    );
    const denied = await start({
      MINION_DIGEST_FIXTURE_MISS_SOURCE: '1',
      MINION_DIGEST_FIXTURE_CLEANUP: '1',
    });
    let negative;
    try {
      assert.equal((await invoke(denied.origin)).code, 0);
      negative = await (await fetch(denied.origin + '/fixture/state')).json();
      assert.equal(negative.deniedHttps, 1);
      assert.equal(negative.sourceCalls, 0);
      assert.equal(negative.modelCalls, 0);
      assert.equal(negative.cards, 0);
      assert.equal(negative.runs, 0);
      assert.match(negative.failure, /External HTTPS denied/);
    } finally {
      await denied.stop();
    }
    let fixture = await start();
    const evidence = {
      negativeControl: negative,
      initial: null,
      afterEmpty: null,
      afterRestart: null,
      scriptSha256: createHash('sha256')
        .update(readFileSync('scripts/ops/pulse-tick.sh'))
        .digest('hex'),
      templateSha256: createHash('sha256')
        .update(readFileSync('deploy/pulse-tick.cron.example'))
        .digest('hex'),
      clientsClosed: true,
      realCronInstalled: false,
    };
    try {
      evidence.initial = await (await fetch(fixture.origin + '/fixture/state')).json();
      assert.deepEqual(evidence.initial, {
        cards: 0,
        runs: 0,
        pending: 0,
        sourceCalls: 0,
        modelCalls: 0,
      });
      assert.notEqual((await invoke(fixture.origin, 'wrong-secret')).code, 0);
      const initialTick = await invoke(fixture.origin);
      assert.equal(initialTick.code, 0, initialTick.output);
      evidence.afterEmpty = await (await fetch(fixture.origin + '/fixture/state')).json();
      assert.equal(evidence.afterEmpty.cards, 0);
      assert.equal(evidence.afterEmpty.modelCalls, 0);
      assert.equal(
        evidence.afterEmpty.runs,
        1,
        JSON.stringify({ initialTick, ...evidence.afterEmpty }),
      );
      const schema = fixture.schema,
        policy = fixture.policy;
      await fixture.stop();
      fixture = await start({
        MINION_DIGEST_FIXTURE_SCHEMA: schema,
        MINION_PULSE_DIGEST_POLICY: JSON.stringify(policy),
        MINION_DIGEST_FIXTURE_VERSION: 'v1',
        MINION_DIGEST_FIXTURE_CLEANUP: '1',
      });
      // Two scheduler deliveries for the same simulated due minute; no browser/CLI enqueue producer exists.
      const ticks = await Promise.all([invoke(fixture.origin), invoke(fixture.origin)]);
      assert.deepEqual(
        ticks.map((t) => t.code),
        [0, 0],
      );
      evidence.afterRestart = await (await fetch(fixture.origin + '/fixture/state')).json();
      assert.deepEqual(evidence.afterRestart, {
        cards: 1,
        runs: 2,
        pending: 0,
        sourceCalls: 1,
        modelCalls: 1,
      });
      const visible = await (await fetch(fixture.origin + '/fixture/proposals')).json();
      assert.equal(visible.proposals.length, 1);
      assert.equal(visible.proposals[0].kind, 'digest');
      evidence.visibleCardId = visible.proposals[0].id;
      if (process.env.MINION_DIGEST_SCHEDULED_PROPOSAL)
        writeFileSync(
          process.env.MINION_DIGEST_SCHEDULED_PROPOSAL,
          JSON.stringify(visible.proposals[0], null, 2) + '\n',
          { mode: 0o600 },
        );
      assert.equal((await invoke(fixture.origin)).code, 0);
      assert.deepEqual(
        await (await fetch(fixture.origin + '/fixture/state')).json(),
        evidence.afterRestart,
      );
      if (process.env.MINION_DIGEST_SCHEDULER_EVIDENCE)
        writeFileSync(
          process.env.MINION_DIGEST_SCHEDULER_EVIDENCE,
          JSON.stringify(evidence, null, 2) + '\n',
          { mode: 0o600 },
        );
    } finally {
      await fixture.stop();
    }
  },
);

test(
  'actual cold restarts fence only retained owner on missing or malformed policy and deny absent invalid or mismatching scope',
  { timeout: 150000 },
  async () => {
    const receipts = [];
    for (const mode of ['missing', 'malformed', 'absent-scope', 'invalid-explicit', 'mismatch']) {
      let fixture = await start();
      try {
        const admitted = mode !== 'missing';
        assert.equal(
          (
            await fetch(
              fixture.origin + '/fixture/prepare-revocation' + (admitted ? '?admit=1' : ''),
              { method: 'POST' },
            )
          ).status,
          200,
        );
        const before = await (await fetch(fixture.origin + '/fixture/state?detail=1')).json();
        const schema = fixture.schema,
          policy = fixture.policy,
          workerConfig = fixture.workerConfig;
        await fixture.stop();
        fixture = await start({
          MINION_DIGEST_FIXTURE_SCHEMA: schema,
          MINION_PULSE_DIGEST_POLICY: JSON.stringify(policy),
          MINION_PULSE_DIGEST_SCOPE: JSON.stringify({
            tenantId: policy.tenantId,
            ownerProfileId: policy.ownerProfileId,
          }),
          MINION_DIGEST_FIXTURE_POLICY_MODE: mode,
          MINION_DIGEST_FIXTURE_CLEANUP: '1',
          ...(mode === 'invalid-explicit'
            ? { MINION_DIGEST_FIXTURE_KEEP_D_SCOPE: '1', MINION_PULSE_WORKER_CONFIG: workerConfig }
            : {}),
        });
        const tick = await invoke(fixture.origin);
        assert.equal(tick.code, 0, tick.output);
        const after = await (await fetch(fixture.origin + '/fixture/state?detail=1')).json();
        assert.equal(after.cards, 0);
        assert.equal(after.modelCalls, 0);
        assert.equal(after.sourceCalls, 0);
        if (['missing', 'malformed'].includes(mode)) {
          assert.equal(after.runStates[0].state, admitted ? 'indeterminate' : 'canceled');
          assert.equal(after.namespaces[0].enabled, false);
          assert(after.namespaces[0].collection_generation > 17);
          assert.equal(after.namespaces[0].collection_owner, null);
        } else {
          assert.deepEqual(after.namespaces, before.namespaces);
          assert.deepEqual(after.runStates, before.runStates);
        }
        assert.equal(
          after.namespaces[0].reserved_micro_usd,
          before.namespaces[0].reserved_micro_usd,
        );
        assert.equal(
          after.namespaces[0].unknown_exposure_fence,
          before.namespaces[0].unknown_exposure_fence,
        );
        assert.equal(after.namespaces[0].active_attempt_id, before.namespaces[0].active_attempt_id);
        receipts.push({ mode, before, after, tick: JSON.parse(tick.output) });
      } finally {
        await fixture.stop();
      }
    }
    if (process.env.MINION_DIGEST_SCHEDULER_EVIDENCE)
      writeFileSync(
        process.env.MINION_DIGEST_SCHEDULER_EVIDENCE + '.scope.json',
        JSON.stringify(
          {
            configuration:
              'strict retained MINION_PULSE_DIGEST_SCOPE; exact D scope fallback only when explicit scope is absent',
            freshProcesses: true,
            receipts,
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      );
  },
);
