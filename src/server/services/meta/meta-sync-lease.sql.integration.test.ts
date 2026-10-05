import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({ pool: vi.fn(), fetchImage: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
vi.mock('../ssrf-guard', () => ({
  fetchImageSafely: boundary.fetchImage,
}));

import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import {
  metaMediaMirrorEffects,
  metaPostMedia,
  type MetaConnection,
  type MetaSyncJob,
} from '$server/db/pg-meta-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { BlobStorageDriver } from '$server/storage/blob';
import { cancelJob, claimJob, leaseFor, settleJob } from './meta-sync-jobs.service';
import {
  MetaOwnershipLostError,
  renewMetaJobLease,
  startMetaJobExecution,
  type MetaJobExecution,
} from './meta-sync-execution';
import { mirrorMediaCandidate, reconcileMediaCleanup } from './meta-media-mirror.service';
import { publishRefreshedConnectionToken } from './meta-sync.service';

type Client = ReturnType<typeof postgres>;
const clients = new AsyncLocalStorage<Client>();
const pending = new Set<Promise<unknown>>();
const releases = new Set<() => void>();
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: Client;
let a: Client;
let b: Client;
let pidA: number;
let pidB: number;
const schema = `qc_job_stock_${randomUUID().replaceAll('-', '')}`;
const ORG = '10000000-0000-4000-8000-000000000011';
const OTHER = '10000000-0000-4000-8000-000000000012';
const OWNER_A = '20000000-0000-4000-8000-000000000011';
const OWNER_B = '20000000-0000-4000-8000-000000000012';
const migrationFiles = [
  '20260704150000_meta.sql',
  '20260705120000_meta_post_media.sql',
  '20261003100000_meta_sync_leases.sql',
] as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  releases.add(resolve);
  return { promise, resolve };
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Native Meta fixture did not reach the required concurrency boundary');
}

function on<T>(client: Client, operation: () => Promise<T>): Promise<T> {
  const task = clients.run(client, operation);
  pending.add(task);
  void task.then(
    () => pending.delete(task),
    () => pending.delete(task),
  );
  return task;
}

function inOrg<T>(client: Client, tenantId: string, operation: (ctx: CoreCtx) => Promise<T>) {
  return on(client, () => operation({ db: getCoreDb(), tenantId }));
}

async function createQueuedJob(kind = 'posts', orgId = ORG): Promise<string> {
  const id = randomUUID();
  await owner`INSERT INTO meta_sync_jobs (id,org_id,kind,status) VALUES (${id},${orgId},${kind},'queued')`;
  return id;
}

async function claim(
  client: Client,
  jobId: string,
  ownerId: string,
  orgId = ORG,
): Promise<MetaSyncJob | null> {
  return inOrg(client, orgId, (ctx) => claimJob(ctx, jobId, ownerId));
}

function executionFor(client: Client, job: MetaSyncJob): { ctx: CoreCtx; run: MetaJobExecution } {
  let ctx!: CoreCtx;
  clients.run(client, () => {
    ctx = { db: getCoreDb(), tenantId: job.orgId };
  });
  return {
    ctx,
    run: startMetaJobExecution(ctx, job, leaseFor(job), async () => true),
  };
}

async function status(jobId: string) {
  return (
    await owner`SELECT status,page_cursor,counts,lease_owner,lease_generation,lease_expires_at
    FROM meta_sync_jobs WHERE id=${jobId}`
  )[0];
}

async function waitEvent(pid: number) {
  return (await owner`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`)[0]
    ?.wait_event_type;
}

function storage(objects: Set<string>, deleted: string[]): BlobStorageDriver {
  return {
    put: async (key) => {
      objects.add(key);
    },
    getSignedUrl: async (key) => `https://invalid.example/${key}`,
    delete: async (key) => {
      objects.delete(key);
      deleted.push(key);
    },
    presignPut: async (key) => `https://invalid.example/${key}`,
    head: async (key) => (objects.has(key) ? { size: 3, contentType: 'image/jpeg' } : null),
  };
}

function media(sourceUrl: string) {
  const now = new Date();
  return {
    orgId: ORG,
    platform: 'fb',
    postId: 'post-mirror',
    fileId: null,
    activeEffectId: null,
    sourceUrl,
    mediaType: 'IMAGE',
    status: 'pending',
    error: null,
    attempts: 0,
    fetchedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

beforeAll(async () => {
  harness = await openDisposablePostgres();
  owner = harness.owner;
  const sources = migrationFiles.map((file) =>
    readFileSync(new URL(`../../../../supabase/migrations/${file}`, import.meta.url), 'utf8'),
  );
  await owner.unsafe(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";`);
  for (const source of sources) {
    await owner.unsafe(source.replaceAll('public.', `"${schema}".`));
  }
  await owner.unsafe(`CREATE TABLE "${schema}".files (
      id text PRIMARY KEY,
      tenant_id uuid NOT NULL,
      uploaded_by uuid,
      b2_file_key text NOT NULL,
      file_name text NOT NULL,
      content_type text NOT NULL,
      size_bytes bigint NOT NULL,
      category text NOT NULL DEFAULT 'general',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    GRANT SELECT,INSERT,UPDATE,DELETE ON "${schema}".files TO app_ledger;
    ALTER TABLE "${schema}".files ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "${schema}".files FORCE ROW LEVEL SECURITY;
    CREATE POLICY files_org ON "${schema}".files TO app_ledger
      USING (tenant_id::text=current_setting('app.current_org_id',true))
      WITH CHECK (tenant_id::text=current_setting('app.current_org_id',true));
    GRANT USAGE ON SCHEMA "${schema}" TO app_ledger;
    COMMENT ON SCHEMA "${schema}" IS 'minion-360-fixture:${schema}'`);
  owner = harness.createConnection(schema);
  a = harness.createConnection(schema);
  b = harness.createConnection(schema);
  pidA = (await a`SELECT pg_backend_pid() AS pid`)[0].pid;
  pidB = (await b`SELECT pg_backend_pid() AS pid`)[0].pid;
  boundary.pool.mockImplementation(() => {
    const client = clients.getStore();
    if (!client) throw new Error('No explicitly selected disposable Meta client');
    return client;
  });
  console.info('disposable Meta PostgreSQL receipt', {
    ...harness.identity,
    schema,
    schemaSha256: createHash('sha256').update(sources.join('\n')).digest('hex'),
    pidA,
    pidB,
  });
}, 30_000);

beforeEach(async () => {
  pidA = (await a`SELECT pg_backend_pid() AS pid`)[0].pid;
  pidB = (await b`SELECT pg_backend_pid() AS pid`)[0].pid;
  boundary.fetchImage.mockReset();
  await owner`TRUNCATE files,meta_connections,meta_media_mirror_effects,meta_post_media,meta_sync_jobs CASCADE`;
});

afterEach(async () => {
  for (const release of releases) release();
  releases.clear();
  await Promise.allSettled([...pending]);
});

afterAll(async () => {
  if (owner) await owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await harness?.close();
});

describe('native Meta sync lease ownership', () => {
  it('uses separate disposable backends with the real bounded renewal function and restricted RLS role', async () => {
    expect(pidA).not.toBe(pidB);
    const [role] = await owner`SELECT rolbypassrls,
      has_function_privilege('app_ledger',${`${schema}.meta_sync_renew_lease(uuid,text,uuid,integer,integer)`},'EXECUTE') AS renew
      FROM pg_roles WHERE rolname='app_ledger'`;
    expect(role).toEqual(expect.objectContaining({ rolbypassrls: false, renew: true }));
    const [settings] = await owner`SELECT proconfig FROM pg_proc
      WHERE oid=${`${schema}.meta_sync_renew_lease(uuid,text,uuid,integer,integer)`}::regprocedure`;
    expect(settings.proconfig).toEqual(
      expect.arrayContaining(['lock_timeout=4s', 'statement_timeout=5s']),
    );
  });

  it('rejects both partial-null lease states at the actual database constraint', async () => {
    await expect(
      owner`INSERT INTO meta_sync_jobs (org_id,kind,status,lease_owner)
        VALUES (${ORG},'posts','queued',${OWNER_A})`,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owner`INSERT INTO meta_sync_jobs (org_id,kind,status,lease_expires_at)
        VALUES (${ORG},'posts','queued',clock_timestamp()+interval '1 minute')`,
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('allows exactly one winner when two connections claim the same queued job', async () => {
    const jobId = await createQueuedJob();
    const [first, second] = await Promise.all([claim(a, jobId, OWNER_A), claim(b, jobId, OWNER_B)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const row = await status(jobId);
    expect(row).toMatchObject({ status: 'running', lease_generation: 1 });
    expect([OWNER_A, OWNER_B]).toContain(row.lease_owner);
  });

  it('advances generation on expiry takeover and rejects the old renewal while the new owner renews', async () => {
    const jobId = await createQueuedJob();
    const first = (await claim(a, jobId, OWNER_A))!;
    const stale = leaseFor(first);
    await owner`UPDATE meta_sync_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${jobId}`;
    const second = (await claim(b, jobId, OWNER_B))!;
    const live = leaseFor(second);

    await expect(on(a, () => renewMetaJobLease(stale))).resolves.toBe(false);
    await expect(on(b, () => renewMetaJobLease(live))).resolves.toBe(true);
    expect(live.generation).toBe(stale.generation + 1);
  });

  it('rejects stale cursor counts and terminal state after a replacement owner claims', async () => {
    const jobId = await createQueuedJob();
    const first = (await claim(a, jobId, OWNER_A))!;
    const stale = leaseFor(first);
    await owner`UPDATE meta_sync_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${jobId}`;
    const second = (await claim(b, jobId, OWNER_B))!;

    await expect(
      inOrg(a, ORG, (ctx) =>
        settleJob(ctx, stale, {
          status: 'succeeded',
          pageCursor: 'stale-cursor',
          countsDelta: { postsProcessed: 99 },
        }),
      ),
    ).resolves.toBe(false);
    expect(await status(jobId)).toMatchObject({
      status: 'running',
      page_cursor: null,
      counts: {},
      lease_owner: OWNER_B,
      lease_generation: second.leaseGeneration,
    });
  });

  it('cancellation increments generation and rejects a late completion from the cancelled owner', async () => {
    const jobId = await createQueuedJob();
    const claimed = (await claim(a, jobId, OWNER_A))!;
    const stale = leaseFor(claimed);

    await expect(inOrg(b, ORG, (ctx) => cancelJob(ctx, jobId))).resolves.toBe(true);
    await expect(
      inOrg(a, ORG, (ctx) => settleJob(ctx, stale, { status: 'succeeded' })),
    ).resolves.toBe(false);
    expect(await status(jobId)).toMatchObject({
      status: 'cancelled',
      lease_owner: null,
      lease_generation: stale.generation + 1,
    });
  });

  it('denies cross-org job claims and mirror-effect reads under the actual app role', async () => {
    const jobId = await createQueuedJob();
    const effectId = randomUUID();
    await owner`INSERT INTO meta_media_mirror_effects
      (id,org_id,platform,post_id,digest,source_url,object_key,file_id,size_bytes,content_type,state,writer_deadline_at)
      VALUES (${effectId},${ORG},'fb','post-1',${'a'.repeat(64)},'https://cdn.invalid/a',
        'old-key','file-old',3,'image/jpeg','cleanup_pending',clock_timestamp()-interval '1 second')`;

    await expect(claim(b, jobId, OWNER_B, OTHER)).resolves.toBeNull();
    const rows = await inOrg(b, OTHER, (ctx) =>
      withOrgCore(ctx, (tx) =>
        tx.select({ id: metaMediaMirrorEffects.id }).from(metaMediaMirrorEffects),
      ),
    );
    expect(rows).toEqual([]);
  });

  it('rolls back a domain write when row-lock waiting carries the transaction past lease expiry', async () => {
    const jobId = await createQueuedJob();
    const claimed = (await claim(a, jobId, OWNER_A))!;
    await owner`INSERT INTO meta_post_media (org_id,platform,post_id,source_url,status)
      VALUES (${ORG},'fb','post-lock','https://cdn.invalid/lock','pending')`;
    await owner`UPDATE meta_sync_jobs SET lease_expires_at=clock_timestamp()+interval '250 milliseconds'
      WHERE id=${jobId}`;
    const lockHeld = deferred();
    const unlock = deferred();
    const locker = on(b, () =>
      b.begin(async (tx) => {
        await tx`SELECT id FROM meta_sync_jobs WHERE id=${jobId} FOR UPDATE`;
        lockHeld.resolve();
        await unlock.promise;
      }),
    );
    await lockHeld.promise;
    const { run } = executionFor(a, claimed);
    const late = on(a, () =>
      run.withOwnership(async (tx) => {
        await tx
          .update(metaPostMedia)
          .set({ status: 'mirrored' })
          .where(
            and(
              eq(metaPostMedia.orgId, ORG),
              eq(metaPostMedia.platform, 'fb'),
              eq(metaPostMedia.postId, 'post-lock'),
            ),
          );
      }),
    );
    await until(async () => (await waitEvent(pidA)) === 'Lock');
    await new Promise((resolve) => setTimeout(resolve, 300));
    unlock.resolve();
    await locker;
    await expect(late).rejects.toBeInstanceOf(MetaOwnershipLostError);
    expect(
      (await owner`SELECT status FROM meta_post_media WHERE post_id='post-lock'`)[0].status,
    ).toBe('pending');
    await run.stop();
  });

  it('fences a late domain publication after an expired generation is stolen', async () => {
    const jobId = await createQueuedJob();
    const first = (await claim(a, jobId, OWNER_A))!;
    await owner`INSERT INTO meta_post_media (org_id,platform,post_id,source_url,status)
      VALUES (${ORG},'fb','post-late','https://cdn.invalid/late','pending')`;
    const { run } = executionFor(a, first);

    await owner`UPDATE meta_sync_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${jobId}`;
    await claim(b, jobId, OWNER_B);
    await expect(
      on(a, () =>
        run.withOwnership(async (tx) => {
          await tx
            .update(metaPostMedia)
            .set({ status: 'mirrored' })
            .where(eq(metaPostMedia.postId, 'post-late'));
        }),
      ),
    ).rejects.toBeInstanceOf(MetaOwnershipLostError);
    expect(
      (await owner`SELECT status FROM meta_post_media WHERE post_id='post-late'`)[0].status,
    ).toBe('pending');
    await run.stop();
  });

  it('connection compare-and-swap preserves a user revocation and a competing token refresh', async () => {
    const jobId = await createQueuedJob();
    const claimed = (await claim(a, jobId, OWNER_A))!;
    const { ctx, run } = executionFor(a, claimed);
    const revokedId = randomUUID();
    const refreshedId = randomUUID();
    const stableId = randomUUID();
    const capturedAt = new Date('2026-10-03T12:00:00.000Z');
    const capturedExpiry = new Date('2026-11-01T00:00:00.000Z');
    const databaseCapturedAt = '2026-10-03T12:00:00.000789Z';
    const databaseCapturedExpiry = '2026-11-01T00:00:00.000789Z';
    const newerAt = new Date('2026-10-03T12:00:01.000Z');
    await owner`INSERT INTO meta_connections
      (id,org_id,kind,token_ciphertext,token_iv,token_expires_at,status,updated_at)
      VALUES
      (${revokedId},${ORG},'ig_login','old-revoked-token','old-revoked-iv',${databaseCapturedExpiry},'active',${databaseCapturedAt}),
      (${refreshedId},${ORG},'ig_login','old-racing-token','old-racing-iv',${databaseCapturedExpiry},'active',${databaseCapturedAt}),
      (${stableId},${ORG},'ig_login','old-stable-token','old-stable-iv',${databaseCapturedExpiry},'active',${databaseCapturedAt})`;
    const snapshot = (id: string, tokenCiphertext: string, tokenIv: string): MetaConnection => ({
      id,
      orgId: ORG,
      kind: 'ig_login',
      fbUserId: null,
      tokenCiphertext,
      tokenIv,
      tokenExpiresAt: capturedExpiry,
      grantedScopes: [],
      status: 'active',
      connectedBy: null,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    });

    const stable = await on(a, () =>
      publishRefreshedConnectionToken(
        ctx,
        run,
        snapshot(stableId, 'old-stable-token', 'old-stable-iv'),
        {
          tokenCiphertext: 'stable-refreshed-token',
          tokenIv: 'stable-refreshed-iv',
          tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
        },
      ),
    );
    expect(stable).toMatchObject({
      tokenCiphertext: 'stable-refreshed-token',
      tokenIv: 'stable-refreshed-iv',
    });

    await b`UPDATE meta_connections SET status='revoked',updated_at=${newerAt.toISOString()}
      WHERE id=${revokedId}`;
    await expect(
      on(a, () =>
        publishRefreshedConnectionToken(
          ctx,
          run,
          snapshot(revokedId, 'old-revoked-token', 'old-revoked-iv'),
          {
            tokenCiphertext: 'late-provider-token',
            tokenIv: 'late-provider-iv',
            tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
          },
        ),
      ),
    ).resolves.toBeNull();

    await b`UPDATE meta_connections SET token_ciphertext='winner-token',token_iv='winner-iv',updated_at=${newerAt.toISOString()}
      WHERE id=${refreshedId}`;
    const canonical = await on(a, () =>
      publishRefreshedConnectionToken(
        ctx,
        run,
        snapshot(refreshedId, 'old-racing-token', 'old-racing-iv'),
        {
          tokenCiphertext: 'loser-token',
          tokenIv: 'loser-iv',
          tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
        },
      ),
    );
    expect(canonical).toMatchObject({ tokenCiphertext: 'winner-token', tokenIv: 'winner-iv' });
    expect(
      await owner`SELECT id,status,token_ciphertext,token_iv FROM meta_connections
        WHERE id IN (${revokedId},${refreshedId},${stableId}) ORDER BY id`,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: revokedId,
          status: 'revoked',
          token_ciphertext: 'old-revoked-token',
        }),
        expect.objectContaining({
          id: refreshedId,
          status: 'active',
          token_ciphertext: 'winner-token',
          token_iv: 'winner-iv',
        }),
        expect.objectContaining({
          id: stableId,
          status: 'active',
          token_ciphertext: 'stable-refreshed-token',
          token_iv: 'stable-refreshed-iv',
        }),
      ]),
    );
    await run.stop();
  });

  it('recovers a put response loss by reusing one active digest effect and publishing one file identity', async () => {
    const jobId = await createQueuedJob();
    const claimed = (await claim(a, jobId, OWNER_A))!;
    const { ctx, run } = executionFor(a, claimed);
    const sourceUrl = 'https://cdn.invalid/crash.jpg';
    const row = media(sourceUrl);
    await owner`INSERT INTO meta_post_media
      (org_id,platform,post_id,source_url,media_type,status)
      VALUES (${ORG},'fb','post-mirror',${sourceUrl},'IMAGE','pending')`;
    boundary.fetchImage.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
      fileName: 'crash.jpg',
    });
    const objects = new Map<string, { size: number; contentType: string }>();
    let loseResponse = true;
    const puts: string[] = [];
    const driver: BlobStorageDriver = {
      put: async (key, body, contentType) => {
        puts.push(key);
        objects.set(key, { size: body.byteLength, contentType });
        if (loseResponse) throw new Error('synthetic response loss after durable put');
      },
      getSignedUrl: async (key) => `https://invalid.example/${key}`,
      delete: async (key) => {
        objects.delete(key);
      },
      presignPut: async (key) => `https://invalid.example/${key}`,
      head: async (key) => objects.get(key) ?? null,
    };

    await expect(on(a, () => mirrorMediaCandidate(ctx, run, row, driver))).resolves.toBe('failed');
    loseResponse = false;
    await expect(on(a, () => mirrorMediaCandidate(ctx, run, row, driver))).resolves.toBe(
      'mirrored',
    );
    expect(puts).toHaveLength(1);
    expect((await owner`SELECT count(*)::int AS n FROM meta_media_mirror_effects`)[0].n).toBe(1);
    expect((await owner`SELECT count(*)::int AS n FROM files`)[0].n).toBe(1);
    expect(
      (
        await owner`SELECT status,file_id,active_effect_id FROM meta_post_media WHERE post_id='post-mirror'`
      )[0],
    ).toEqual(
      expect.objectContaining({
        status: 'mirrored',
        file_id: expect.any(String),
        active_effect_id: expect.any(String),
      }),
    );
    await run.stop();
  });

  it('creates immutable distinct keys when fetched bytes change and later revert to an old digest', async () => {
    const jobId = await createQueuedJob();
    const claimed = (await claim(a, jobId, OWNER_A))!;
    const { ctx, run } = executionFor(a, claimed);
    const sources = [
      'https://cdn.invalid/first.jpg',
      'https://cdn.invalid/changed.jpg',
      'https://cdn.invalid/reverted.jpg',
    ];
    await owner`INSERT INTO meta_post_media
      (org_id,platform,post_id,source_url,media_type,status)
      VALUES (${ORG},'fb','post-mirror',${sources[0]},'IMAGE','pending')`;
    const objects = new Map<string, { size: number; contentType: string }>();
    let failAfterPut = true;
    const driver: BlobStorageDriver = {
      put: async (key, body, contentType) => {
        objects.set(key, { size: body.byteLength, contentType });
        if (failAfterPut) throw new Error('synthetic response loss after durable put');
      },
      getSignedUrl: async (key) => `https://invalid.example/${key}`,
      delete: async (key) => {
        objects.delete(key);
      },
      presignPut: async (key) => `https://invalid.example/${key}`,
      head: async (key) => objects.get(key) ?? null,
    };
    const bytes = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([1])];

    for (let index = 0; index < sources.length; index++) {
      boundary.fetchImage.mockResolvedValueOnce({
        data: bytes[index],
        contentType: 'image/jpeg',
        fileName: `image-${index}.jpg`,
      });
      if (index > 0) {
        await owner`UPDATE meta_post_media SET source_url=${sources[index]},status='pending'
          WHERE org_id=${ORG} AND platform='fb' AND post_id='post-mirror'`;
      }
      const result = await on(a, () =>
        mirrorMediaCandidate(ctx, run, media(sources[index]), driver),
      );
      const effectStates = await owner`
        SELECT digest,source_url,object_key,state,error
        FROM meta_media_mirror_effects
        ORDER BY created_at,id`;
      const [mediaState] = await owner`
        SELECT source_url,status,error,active_effect_id
        FROM meta_post_media
        WHERE org_id=${ORG} AND platform='fb' AND post_id='post-mirror'`;
      expect(
        effectStates,
        `attempt ${index}; media=${JSON.stringify(mediaState)}; effects=${JSON.stringify(effectStates)}`,
      ).toHaveLength(index + 1);
      expect(result, `attempt ${index}; effects=${JSON.stringify(effectStates)}`).toBe('failed');
    }

    failAfterPut = false;
    boundary.fetchImage.mockResolvedValueOnce({
      data: bytes[2],
      contentType: 'image/jpeg',
      fileName: 'image-final.jpg',
    });
    await expect(
      on(a, () => mirrorMediaCandidate(ctx, run, media(sources[2]), driver)),
    ).resolves.toBe('mirrored');
    const effects =
      await owner`SELECT id,digest,source_url,object_key,state FROM meta_media_mirror_effects
      ORDER BY created_at,id`;
    expect(effects).toHaveLength(3);
    expect(effects.map((effect) => effect.state).sort()).toEqual([
      'cleanup_pending',
      'cleanup_pending',
      'published',
    ]);
    const first = effects.find((effect) => effect.source_url === sources[0]);
    const reverted = effects.find((effect) => effect.source_url === sources[2]);
    expect(first?.digest).toBe(reverted?.digest);
    expect(first?.id).not.toBe(reverted?.id);
    expect(first?.object_key).not.toBe(reverted?.object_key);
    await run.stop();
  });

  it('binds the active effect pointer to the same organization platform and post', async () => {
    const valid = randomUUID();
    const foreign = randomUUID();
    await owner`INSERT INTO meta_post_media (org_id,platform,post_id,status)
      VALUES (${ORG},'fb','post-fk','pending')`;
    await owner`INSERT INTO meta_media_mirror_effects
      (id,org_id,platform,post_id,digest,source_url,object_key,file_id,size_bytes,content_type,state,writer_deadline_at)
      VALUES
      (${valid},${ORG},'fb','post-fk',${'b'.repeat(64)},'https://cdn.invalid/valid','valid-key','valid-file',3,'image/jpeg','active',clock_timestamp()+interval '1 minute'),
      (${foreign},${OTHER},'fb','post-fk',${'b'.repeat(64)},'https://cdn.invalid/foreign','foreign-key','foreign-file',3,'image/jpeg','active',clock_timestamp()+interval '1 minute')`;

    await expect(
      owner`UPDATE meta_post_media SET active_effect_id=${foreign} WHERE org_id=${ORG} AND post_id='post-fk'`,
    ).rejects.toMatchObject({ code: '23503' });
    await owner`UPDATE meta_post_media SET active_effect_id=${valid} WHERE org_id=${ORG} AND post_id='post-fk'`;
    expect(
      (await owner`SELECT active_effect_id FROM meta_post_media WHERE post_id='post-fk'`)[0],
    ).toEqual({ active_effect_id: valid });
  });

  it('rechecks an absent cleanup tombstone and deletes a truly late put without touching a same-digest replacement', async () => {
    const jobId = await createQueuedJob();
    const claimed = (await claim(a, jobId, OWNER_A))!;
    const oldId = randomUUID();
    const replacementId = randomUUID();
    const digest = 'c'.repeat(64);
    await owner`INSERT INTO meta_post_media (org_id,platform,post_id,status,active_effect_id)
      VALUES (${ORG},'fb','post-cleanup','mirroring',NULL)`;
    await owner`INSERT INTO meta_media_mirror_effects
      (id,org_id,platform,post_id,digest,source_url,object_key,file_id,size_bytes,content_type,state,writer_deadline_at,next_cleanup_at)
      VALUES
      (${oldId},${ORG},'fb','post-cleanup',${digest},'https://cdn.invalid/old','old-key','old-file',3,'image/jpeg','cleanup_pending',clock_timestamp()-interval '1 second',clock_timestamp()-interval '1 second'),
      (${replacementId},${ORG},'fb','post-cleanup',${digest},'https://cdn.invalid/new','replacement-key','replacement-file',3,'image/jpeg','active',clock_timestamp()+interval '1 minute',NULL)`;
    await owner`UPDATE meta_post_media SET active_effect_id=${replacementId}
      WHERE org_id=${ORG} AND platform='fb' AND post_id='post-cleanup'`;
    const objects = new Set<string>(['replacement-key']);
    const deleted: string[] = [];
    const fakeStorage = storage(objects, deleted);
    const { run } = executionFor(a, claimed);

    await on(a, () => reconcileMediaCleanup(run, fakeStorage));
    const afterAbsent = (
      await owner`SELECT cleanup_attempts,object_absent_at,next_cleanup_at FROM meta_media_mirror_effects WHERE id=${oldId}`
    )[0];
    expect(afterAbsent.cleanup_attempts).toBe(1);
    expect(afterAbsent.object_absent_at).toBeInstanceOf(Date);
    expect(afterAbsent.next_cleanup_at.getTime()).toBeGreaterThan(Date.now());

    objects.add('old-key');
    await owner`UPDATE meta_media_mirror_effects SET next_cleanup_at=clock_timestamp()-interval '1 second' WHERE id=${oldId}`;
    await on(a, () => reconcileMediaCleanup(run, fakeStorage));
    expect(deleted).toEqual(['old-key']);
    expect(objects.has('replacement-key')).toBe(true);
    expect(
      (await owner`SELECT cleanup_attempts FROM meta_media_mirror_effects WHERE id=${oldId}`)[0],
    ).toEqual({ cleanup_attempts: 2 });
    await run.stop();
  });

  it('advances the cleanup schedule after a storage failure without claiming remote absence', async () => {
    const jobId = await createQueuedJob();
    const claimed = (await claim(a, jobId, OWNER_A))!;
    const effectId = randomUUID();
    await owner`INSERT INTO meta_media_mirror_effects
      (id,org_id,platform,post_id,digest,source_url,object_key,file_id,size_bytes,content_type,state,writer_deadline_at,next_cleanup_at)
      VALUES (${effectId},${ORG},'fb','post-cleanup-failure',${'e'.repeat(64)},'https://cdn.invalid/failure','failure-key','failure-file',3,'image/jpeg','cleanup_pending',clock_timestamp()-interval '1 second',clock_timestamp()-interval '1 second')`;
    const driver: BlobStorageDriver = {
      put: async () => {},
      getSignedUrl: async () => 'https://invalid.example/failure',
      delete: async () => {},
      presignPut: async () => 'https://invalid.example/failure',
      head: async () => {
        throw new Error('synthetic storage outage');
      },
    };
    const { run } = executionFor(a, claimed);

    await on(a, () => reconcileMediaCleanup(run, driver));
    const effect = (
      await owner`SELECT cleanup_attempts,object_absent_at,error,next_cleanup_at
        FROM meta_media_mirror_effects WHERE id=${effectId}`
    )[0];
    expect(effect).toMatchObject({
      cleanup_attempts: 1,
      object_absent_at: null,
      error: 'synthetic storage outage',
    });
    expect(effect.next_cleanup_at.getTime()).toBeGreaterThan(Date.now());
    await run.stop();
  });

  it('orders the bounded cleanup queue fairly and never selects published effects', async () => {
    const jobId = await createQueuedJob();
    const claimed = (await claim(a, jobId, OWNER_A))!;
    const rows = Array.from({ length: 7 }, (_, index) => ({
      id: randomUUID(),
      key: `cleanup-${index}`,
      state: index === 6 ? 'published' : 'cleanup_pending',
      seconds: 20 - index,
    }));
    for (const row of rows) {
      await owner`INSERT INTO meta_media_mirror_effects
        (id,org_id,platform,post_id,digest,source_url,object_key,file_id,size_bytes,content_type,state,writer_deadline_at,next_cleanup_at)
        VALUES (${row.id},${ORG},'fb',${`post-${row.key}`},${'d'.repeat(64)},'https://cdn.invalid/x',${row.key},${`file-${row.key}`},3,'image/jpeg',${row.state},clock_timestamp()-interval '1 second',clock_timestamp()-(${row.seconds} * interval '1 second'))`;
    }
    const objects = new Set(rows.map((row) => row.key));
    const deleted: string[] = [];
    const { run } = executionFor(a, claimed);
    await on(a, () => reconcileMediaCleanup(run, storage(objects, deleted), 5));
    expect(deleted).toEqual(rows.slice(0, 5).map((row) => row.key));

    await on(a, () => reconcileMediaCleanup(run, storage(objects, deleted), 5));
    expect(deleted).toEqual(rows.slice(0, 6).map((row) => row.key));
    expect(objects.has(rows[6].key)).toBe(true);
    await run.stop();
  });
});
