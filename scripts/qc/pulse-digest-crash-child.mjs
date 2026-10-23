/** Local child-process fixture; uses actual service modules through Vite's TS loader. */
import { createServer } from 'vite';
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
        if (id.startsWith('$env/')) return '\0pulse-crash-env:' + id;
      },
      load(id) {
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
const { openDisposablePostgres } = await loader.ssrLoadModule('/scripts/qc/disposable-postgres.ts');
const harness = await openDisposablePostgres();
if (!process.env.MINION_PULSE_CRASH_SCHEMA) throw new Error('Explicit owned crash schema required');
const pg = harness.createConnection(process.env.MINION_PULSE_CRASH_SCHEMA);
globalThis.__pulseCrashPg = pg;
configureCache({ namespace: 'pulse-crash', backend: createBackend({ backend: 'noop' }) });
const { runSelectedTick, registerJobHandler } = await loader.ssrLoadModule(
  '/src/server/services/bg-runtime.ts',
);
const { advancePulseDigest } = await loader.ssrLoadModule(
  '/src/server/services/pulse-digest.worker.ts',
);
const { pulseProposals } = await loader.ssrLoadModule('/src/server/db/pg-schema/pulse.ts');
const { pulseDigestSources } = await loader.ssrLoadModule(
  '/src/server/db/pg-schema/pulse-digest.ts',
);
const { bgJobs } = await loader.ssrLoadModule('/src/server/db/pg-schema/bg-jobs.ts');
const nativeFetch = globalThis.fetch;
const local = new URL(process.env.MINION_DIGEST_FIXTURE_PROVIDER);
if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1')
  throw new Error('Local provider required');
globalThis.fetch = (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://openrouter.ai' || url.pathname !== '/api/v1/chat/completions')
    throw new Error('External fixture network denied');
  return nativeFetch(local.origin + url.pathname, init);
};
const checkpoint = process.env.MINION_PULSE_CRASH_CHECKPOINT;
function wrapBuilder(builder, kind) {
  return new Proxy(builder, {
    get(target, key) {
      if (key === 'then')
        return (resolve, reject) =>
          target
            .then(async (value) => {
              if (checkpoint === kind) process.exit(74);
              return value;
            })
            .then(resolve, reject);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function'
        ? (...args) => {
            const next = value.apply(target, args);
            return next && typeof next === 'object' ? wrapBuilder(next, kind) : next;
          }
        : value;
    },
  });
}
function wrapTx(tx) {
  return new Proxy(tx, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === 'insert' || key === 'update')
        return (table) =>
          wrapBuilder(
            value.call(target, table),
            table === pulseProposals
              ? 'after-card'
              : table === pulseDigestSources
                ? 'after-cursor'
                : table === bgJobs
                  ? 'before-commit'
                  : 'none',
          );
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
registerJobHandler({
  type: 'pulse_digest',
  pulseRetry: true,
  advance: (job, execution) =>
    advancePulseDigest(job, {
      ...execution,
      withOwnership: async (operation) => {
        const value = await execution.withOwnership((tx, current) =>
          operation(wrapTx(tx), current),
        );
        const [row] = await pg`select state from pulse_digest_runs where bg_job_id=${job.id}`;
        if (checkpoint === 'after-admission' && row?.state === 'reasoning_admitted')
          process.exit(74);
        if (checkpoint === 'after-received' && row?.state === 'reasoning_received')
          process.exit(74);
        if (checkpoint === 'after-commit' && row?.state === 'published') process.exit(74);
        return value;
      },
    }),
});
await runSelectedTick({
  tenantId: process.env.MINION_PULSE_CRASH_ORG,
  ownerProfileId: process.env.MINION_PULSE_CRASH_PROFILE,
  types: ['pulse_digest'],
  budgetMs: 45000,
});
await harness.close();
await loader.close();
