/**
 * Restore the canonical Brains HNSW accelerator after a measured Supabase
 * capacity upgrade. This is intentionally an operator script: the normal
 * migration runner wraps migrations in a transaction, while PostgreSQL
 * requires CREATE INDEX CONCURRENTLY to run outside a transaction.
 *
 * Dry run (default): bun scripts/restore-brain-ann.ts
 * Apply (only after the dashboard shows measured free disk headroom):
 * bun scripts/restore-brain-ann.ts --apply --free-headroom-gib=1.5
 */
import postgres from 'postgres';

const INDEX_NAME = 'knowledge_chunks_embedding_hnsw';
const APPLY_FLAG = '--apply';
const HEADROOM_PREFIX = '--free-headroom-gib=';
const MINIMUM_FREE_HEADROOM_GIB = 1.5;
const ESTIMATED_HNSW_BYTES_PER_CHUNK = 9 * 1024;
const PEAK_HEADROOM_MULTIPLIER = 2.5;
const LONG_TRANSACTION_MINUTES = 5;

const apply = process.argv.includes(APPLY_FLAG);
const assertedFreeHeadroomGiB = Number(
  process.argv
    .find((argument) => argument.startsWith(HEADROOM_PREFIX))
    ?.slice(HEADROOM_PREFIX.length),
);
const url = process.env.SUPABASE_DB_URL?.trim();

if (!url) throw new Error('SUPABASE_DB_URL is not set');
if (apply && (!Number.isFinite(assertedFreeHeadroomGiB) || assertedFreeHeadroomGiB <= 0)) {
  throw new Error(
    `${APPLY_FLAG} requires ${HEADROOM_PREFIX}<GiB> measured from the provider dashboard`,
  );
}

const client = postgres(url, {
  prepare: false,
  max: 1,
  application_name: 'minion-restore-brain-ann',
  onnotice: () => {},
});

interface IndexState {
  name: string;
  valid: boolean;
  ready: boolean;
  live: boolean;
  bytes: string;
}

let buildStarted = false;

async function indexState(): Promise<IndexState | null> {
  const rows = await client<IndexState[]>`
    select
      index_class.relname as name,
      index_meta.indisvalid as valid,
      index_meta.indisready as ready,
      index_meta.indislive as live,
      pg_relation_size(index_class.oid)::bigint::text as bytes
    from pg_class index_class
    join pg_index index_meta on index_meta.indexrelid = index_class.oid
    join pg_namespace namespace on namespace.oid = index_class.relnamespace
    where namespace.nspname = 'public'
      and index_class.relname = ${INDEX_NAME}
  `;
  return rows[0] ?? null;
}

try {
  const [health] = await client<
    {
      readOnly: string;
      inRecovery: boolean;
      databaseBytes: string;
      embeddedChunks: number;
    }[]
  >`
    select
      current_setting('default_transaction_read_only') as "readOnly",
      pg_is_in_recovery() as "inRecovery",
      pg_database_size(current_database())::bigint::text as "databaseBytes",
      (select count(*)::int from public.knowledge_chunks where embedding is not null)
        as "embeddedChunks"
  `;
  const before = await indexState();
  const estimatedIndexBytes = health.embeddedChunks * ESTIMATED_HNSW_BYTES_PER_CHUNK;
  const requiredFreeHeadroomGiB = Math.max(
    MINIMUM_FREE_HEADROOM_GIB,
    (estimatedIndexBytes * PEAK_HEADROOM_MULTIPLIER) / 1024 ** 3,
  );

  const longTransactions = await client<
    { pid: number; applicationName: string | null; ageSeconds: number }[]
  >`
    select
      pid,
      application_name as "applicationName",
      extract(epoch from (now() - xact_start))::int as "ageSeconds"
    from pg_stat_activity
    where datname = current_database()
      and pid <> pg_backend_pid()
      and xact_start is not null
      and state <> 'idle'
      and xact_start < now() - (${LONG_TRANSACTION_MINUTES}::text || ' minutes')::interval
    order by xact_start
  `;

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        assertedFreeHeadroomGiB: apply ? assertedFreeHeadroomGiB : null,
        estimatedIndexBytes,
        requiredFreeHeadroomGiB,
        health,
        indexBefore: before,
        longTransactions,
      },
      null,
      2,
    ),
  );

  if (health.readOnly !== 'off' || health.inRecovery) {
    throw new Error('Database is not writable primary; refusing ANN restoration');
  }
  if (before && (!before.valid || !before.ready || !before.live)) {
    throw new Error(`Existing ${INDEX_NAME} is invalid; inspect and remove it explicitly first`);
  }
  if (longTransactions.length > 0) {
    throw new Error(
      `Found ${longTransactions.length} transaction(s) older than ${LONG_TRANSACTION_MINUTES} minutes`,
    );
  }
  if (apply && assertedFreeHeadroomGiB < requiredFreeHeadroomGiB) {
    throw new Error(
      `Measured free headroom ${assertedFreeHeadroomGiB} GiB is below the required ${requiredFreeHeadroomGiB.toFixed(2)} GiB`,
    );
  }
  if (apply && !before) {
    // A temporary table exercises the same production writer without persisting
    // application data or consuming durable corpus storage.
    await client.begin(async (tx) => {
      await tx`create temporary table minion_ann_write_probe (id int primary key) on commit drop`;
      await tx`insert into minion_ann_write_probe values (1)`;
    });

    await client.unsafe(`set lock_timeout = '5s'`);
    await client.unsafe(`set statement_timeout = 0`);
    buildStarted = true;
    await client.unsafe(
      `create index concurrently if not exists ${INDEX_NAME}
         on public.knowledge_chunks using hnsw (embedding vector_cosine_ops)`,
    );
    await client.unsafe('analyze public.knowledge_chunks');

    const after = await indexState();
    if (!after?.valid || !after.ready || !after.live) {
      throw new Error(`${INDEX_NAME} did not become valid, ready, and live`);
    }

    const [postHealth] = await client<{ readOnly: string; databaseBytes: string }[]>`
      select
        current_setting('default_transaction_read_only') as "readOnly",
        pg_database_size(current_database())::bigint::text as "databaseBytes"
    `;
    if (postHealth.readOnly !== 'off') {
      throw new Error('Database became read-only after ANN restoration');
    }

    console.log(JSON.stringify({ restored: true, indexAfter: after, postHealth }, null, 2));
  }
} catch (cause) {
  // CREATE INDEX CONCURRENTLY leaves an invalid catalog entry when a build is
  // interrupted (including quota exhaustion). It is safe to remove only this
  // non-canonical accelerator. The session override permits cleanup when the
  // quota controller has switched new transactions to read-only.
  const failed = await indexState().catch(() => null);
  if (apply && buildStarted && failed && (!failed.valid || !failed.ready || !failed.live)) {
    try {
      await client.unsafe('set default_transaction_read_only = off');
      await client.unsafe(`drop index concurrently if exists public.${INDEX_NAME}`);
      console.error(`Removed invalid ${INDEX_NAME} after failed concurrent build`);
    } catch (cleanupCause) {
      console.error(
        `Failed to remove invalid ${INDEX_NAME}; manual cleanup is required`,
        cleanupCause,
      );
    }
  }
  throw cause;
} finally {
  await client.end({ timeout: 5 });
}
