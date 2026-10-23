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
const { advancePulseDispatch } = await loader.ssrLoadModule(
  '/src/server/services/pulse-dispatch.worker.ts',
);
const checkpoint = process.env.MINION_PULSE_CRASH_CHECKPOINT;
let observedAdmission = false;
registerJobHandler({
  type: 'pulse_dispatch',
  pulseRetry: true,
  advance: (job, execution) =>
    advancePulseDispatch(job, {
      ...execution,
      withOwnership: async (operation) => {
        if (checkpoint === 'before-settlement' && observedAdmission) process.exit(74);
        const value = await execution.withOwnership(operation);
        const [row] = await pg`select state from pulse_dispatches where bg_job_id=${job.id}`;
        if (row?.state === 'admitted') {
          observedAdmission = true;
          if (checkpoint === 'after-admission') process.exit(74);
        }
        if (row?.state === 'scheduled' && checkpoint === 'after-settlement') process.exit(74);
        return value;
      },
    }),
});
if (!process.env.MINION_PULSE_CRASH_ORG || !process.env.MINION_PULSE_CRASH_PROFILE)
  throw new Error('Explicit crash scope required');
await runSelectedTick({
  tenantId: process.env.MINION_PULSE_CRASH_ORG,
  ownerProfileId: process.env.MINION_PULSE_CRASH_PROFILE,
  types: ['pulse_dispatch'],
  budgetMs: 25_000,
});
await harness.close();

await loader.close();
