/** Local child-process fixture; uses actual service modules through Vite's TS loader. */
import { createServer } from 'vite';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
let deniedHttps = 0;
https.request = () => {
  deniedHttps++;
  throw new Error('External HTTPS denied in scheduler fixture');
};
syncBuiltinESMExports();
import { fileURLToPath } from 'node:url';
import { configureCache, createBackend } from '@minion-stack/cache';
const root = fileURLToPath(new URL('../../', import.meta.url));
const loader = await createServer({
  configFile: false,
  envDir: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: 'error',
  root,
  server: { middlewareMode: true },
  plugins: [
    {
      name: 'pulse-crash-boundaries',
      resolveId(id, importer) {
        if (
          (id === './pg-pool' && importer?.endsWith('/db/pg-client.ts')) ||
          id === '$server/db/pg-pool' ||
          id === root + 'src/server/db/pg-pool' ||
          id === root + 'src/server/db/pg-pool.ts' ||
          id === '\0pulse-crash-pool'
        )
          return '\0pulse-crash-pool';
        if (
          process.env.MINION_DIGEST_FIXTURE_MISS_SOURCE !== '1' &&
          (id === './pulse-digest.fetch' ||
            id.endsWith('/pulse-digest.fetch.ts') ||
            id === '\0digest-scheduler-source')
        )
          return '\0digest-scheduler-source';
        if (id.startsWith('$env/')) return '\0pulse-crash-env:' + id;
      },
      transform(code, id) {
        if (
          process.env.MINION_DIGEST_FIXTURE_MISS_SOURCE !== '1' &&
          id.split('?')[0].endsWith('/pulse-digest.fetch.ts')
        )
          return 'export const fetchDigestSource=(...args)=>globalThis.__digestFixtureSource(...args);';
        if (id.endsWith('/pulse-digest.collection.ts'))
          return code.replace(
            '} catch {',
            '} catch (fixtureError) { globalThis.__digestFixtureFailure=String(fixtureError);',
          );
      },
      load(id) {
        if (id === '\0digest-scheduler-source')
          return 'export const fetchDigestSource=(...args)=>globalThis.__digestFixtureSource(...args);';
        if (id === '\0pulse-crash-pool' || id.endsWith('/src/server/db/pg-pool.ts'))
          return 'export const getPgClient=()=>globalThis.__pulseCrashPg;export const getRlsPgClient=getPgClient;export const getCriticalPgClient=getPgClient;export const resetAllPgPools=async()=>{};';
        if (id.startsWith('\0pulse-crash-env:'))
          return 'export const env=process.env; export const PUBLIC_APP_URL="http://127.0.0.1:0"; export const PUBLIC_SUPABASE_URL="http://127.0.0.1:0"; export const PUBLIC_SUPABASE_ANON_KEY="disposable";';
      },
    },
  ],
  resolve: {
    alias: {
      '$server/db/pg-pool': '\0pulse-crash-pool',
      $server: root + 'src/server',
      $lib: root + 'src/lib',
    },
  },
});
const { createServer: httpServer } = await import('node:http');
const { openDisposablePostgres } = await loader.ssrLoadModule('/scripts/qc/disposable-postgres.ts');
let harness, pg, schema;
if (process.env.MINION_DIGEST_FIXTURE_SCHEMA) {
  harness = await openDisposablePostgres();
  schema = process.env.MINION_DIGEST_FIXTURE_SCHEMA;
  pg = harness.createConnection(schema);
} else {
  const { openPulsePostgres } = await loader.ssrLoadModule(
    '/src/server/test-utils/pulse-postgres.ts',
  );
  const fixture = await openPulsePostgres();
  harness = fixture.harness;
  pg = fixture.pg;
  schema = fixture.schema;
  const { seedPulseAuthority } = await loader.ssrLoadModule(
    '/src/server/test-utils/pulse-fixtures.ts',
  );
  await seedPulseAuthority(fixture, 'wss://fixture.invalid');
}
globalThis.__pulseCrashPg = pg;
const inheritedWorkerConfig = process.env.MINION_PULSE_WORKER_CONFIG;
if (process.env.MINION_DIGEST_FIXTURE_KEEP_D_SCOPE !== '1')
  delete process.env.MINION_PULSE_WORKER_CONFIG;
configureCache({ namespace: 'digest-scheduler', backend: createBackend({ backend: 'noop' }) });
const { digestFixturePolicy, digestFixtureSnapshot, digestFixtureResponse } =
  await loader.ssrLoadModule('/src/server/test-utils/pulse-digest-fixtures.ts');
const policy = process.env.MINION_PULSE_DIGEST_POLICY
  ? JSON.parse(process.env.MINION_PULSE_DIGEST_POLICY)
  : digestFixturePolicy();
process.env.MINION_PULSE_DIGEST_POLICY = JSON.stringify(policy);
process.env.MINION_PULSE_DIGEST_SCOPE =
  process.env.MINION_PULSE_DIGEST_SCOPE ??
  JSON.stringify({ tenantId: policy.tenantId, ownerProfileId: policy.ownerProfileId });
const policyMode = process.env.MINION_DIGEST_FIXTURE_POLICY_MODE;
if (policyMode === 'missing') delete process.env.MINION_PULSE_DIGEST_POLICY;
if (policyMode === 'malformed') process.env.MINION_PULSE_DIGEST_POLICY = '{';
if (policyMode === 'absent-scope') delete process.env.MINION_PULSE_DIGEST_SCOPE;
if (policyMode === 'mismatch')
  process.env.MINION_PULSE_DIGEST_SCOPE = JSON.stringify({
    tenantId: policy.tenantId,
    ownerProfileId: '20000000-0000-4000-8000-000000000002',
  });
if (policyMode === 'invalid-explicit') process.env.MINION_PULSE_DIGEST_SCOPE = '{';
const version = process.env.MINION_DIGEST_FIXTURE_VERSION || null;
if (version) await pg`update pulse_digest_admission set next_poll_at=now()-interval '1 second'`;
let sourceCalls = 0,
  modelCalls = 0,
  origin;
const nativeFetch = globalThis.fetch;
globalThis.__digestFixtureSource = async (_url, options) => {
  const response = await nativeFetch(origin + '/fixture/source', { signal: options.signal });
  return { status: 200, body: await response.text(), etag: version ?? 'empty', lastModified: null };
};
globalThis.fetch = (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://openrouter.ai' || !url.pathname.endsWith('/chat/completions'))
    throw new Error('External scheduler fixture network denied');
  return nativeFetch(origin + '/fixture/provider', init);
};
const { GET } = await loader.ssrLoadModule('/src/routes/api/pulse/tick/+server.ts');
const { queueDigestSnapshotTx, admitDigestAttemptTx, retainDigestReceipt } =
  await loader.ssrLoadModule('/src/server/services/pulse-digest.store.ts');
const { getCoreDb } = await loader.ssrLoadModule('/src/server/db/pg-client.ts');
const { pulseDigestRuns } = await loader.ssrLoadModule('/src/server/db/pg-schema/pulse-digest.ts');
const { eq } = await import('drizzle-orm');
const { listPending } = await loader.ssrLoadModule('/src/server/services/pulse.service.ts');
const server = httpServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/fixture/proposals') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          proposals: await listPending({
            db: getCoreDb(),
            tenantId: policy.tenantId,
            profileId: policy.ownerProfileId,
          }),
        }),
      );
      return;
    }
    if (url.pathname === '/fixture/prepare-revocation') {
      const db = getCoreDb();
      const snapshot = await digestFixtureSnapshot(policy, 'revocation-v1');
      const queued = await db.transaction((tx) => queueDigestSnapshotTx(tx, policy, snapshot));
      if (!queued) throw new Error('fixture queue denied');
      if (url.searchParams.has('admit')) {
        await pg`update bg_jobs set status='running',lease_generation=1,lease_until=${Date.now() + 60000} where id=${queued.jobId}`;
        const [run] = await db
          .select()
          .from(pulseDigestRuns)
          .where(eq(pulseDigestRuns.id, queued.runId));
        const admitted = await db.transaction((tx) => admitDigestAttemptTx(tx, policy, run, 1));
        await retainDigestReceipt(db, admitted, {
          rawResponse: null,
          receiptHash: 'fixture-unknown-terminal',
          usageStatus: 'unknown',
          costMicroUsd: null,
          resolvedModel: null,
          metadata: { status: 0, reason: 'fixture_lost_response' },
        });
      }
      await pg`update pulse_digest_admission set collection_owner=gen_random_uuid(),collection_generation=17,collection_lease_until=now()+interval '30 seconds'`;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ prepared: true }));
      return;
    }
    if (url.pathname === '/fixture/source') {
      sourceCalls++;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          version
            ? [
                {
                  html_url: `https://github.com/vercel/ai/releases/tag/${version}`,
                  tag_name: `ai@${version}`,
                  name: 'Fixture release',
                  body: 'A supported synthetic dependency change.',
                },
              ]
            : [],
        ),
      );
      return;
    }
    if (url.pathname === '/fixture/provider') {
      for await (const chunk of req) {
      }
      modelCalls++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(digestFixtureResponse(await digestFixtureSnapshot(policy, version))));
      return;
    }
    if (url.pathname === '/fixture/state') {
      const [counts] =
        await pg`select (select count(*)::int from pulse_proposals) cards,(select count(*)::int from pulse_digest_runs) runs,(select count(*)::int from bg_jobs where status in ('queued','running')) pending`;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          ...counts,
          ...(url.searchParams.has('detail')
            ? {
                runStates:
                  await pg`select state,receipt_hash,cost_micro_usd from pulse_digest_runs`,
                namespaces:
                  await pg`select enabled,collection_generation,collection_owner,unknown_exposure_fence,reserved_micro_usd,active_attempt_id from pulse_digest_admission`,
              }
            : {}),
          sourceCalls,
          modelCalls,
          ...(deniedHttps ? { deniedHttps } : {}),
          ...(globalThis.__digestFixtureFailure
            ? { failure: globalThis.__digestFixtureFailure }
            : {}),
        }),
      );
      return;
    }
    if (url.pathname !== '/api/pulse/tick') {
      res.writeHead(404).end();
      return;
    }
    const response = await GET({
      request: new Request(url, {
        method: req.method,
        headers: { authorization: req.headers.authorization ?? '' },
      }),
      url,
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch (error) {
    res.writeHead(error.status ?? 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'fixture_tick_failure' }));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
console.log(
  JSON.stringify({ ready: true, origin, schema, policy, workerConfig: inheritedWorkerConfig }),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (process.env.MINION_DIGEST_FIXTURE_CLEANUP === '1')
    await harness.owner.unsafe(`drop schema ${schema} cascade`);
  await harness.close();
  await loader.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
