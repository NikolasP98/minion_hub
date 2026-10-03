import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openDisposablePostgres,
  validateDisposableDatabaseUrl,
} from '../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({ pool: vi.fn(), report: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: boundary.pool }));
vi.mock('@sentry/sveltekit', () => ({ captureException: boundary.report }));
import { listMentionDirectory } from './mention-directory';

const ACTOR = '10000000-0000-4000-8000-000000000001';
const PERSON = '10000000-0000-4000-8000-000000000002';
const OUTSIDE_ADMIN = '10000000-0000-4000-8000-000000000003';
const ORG = '20000000-0000-4000-8000-000000000001';
const OTHER_ORG = '20000000-0000-4000-8000-000000000002';
const OWNER = { actorId: ACTOR, organizationId: ORG };
const name = `minion_qc_mentions_${randomUUID().replaceAll('-', '')}`;
const marker = 'minion-mention-directory-child:v1';
let parent: Awaited<ReturnType<typeof openDisposablePostgres>> | undefined;
let client: ReturnType<typeof postgres> | undefined;
let created = false;

beforeAll(async () => {
  // Admission proves loopback, fixture owner and database marker before any write.
  parent = await openDisposablePostgres();
  expect(/^minion_qc_mentions_[a-f0-9]{32}$/.test(name)).toBe(true);
  await parent.owner.unsafe(`CREATE DATABASE "${name}" OWNER minion_qc TEMPLATE template0`);
  created = true;
  await parent.owner.unsafe(`COMMENT ON DATABASE "${name}" IS '${marker}'`);
  const url = validateDisposableDatabaseUrl(
    process.env.MINION_QC_DATABASE_URL,
    process.env.MINION_QC_DISPOSABLE,
  );
  url.pathname = `/${name}`;
  client = postgres(url.href, { max: 1, prepare: false, connect_timeout: 3 });
  await client.unsafe(`
    CREATE TABLE public.organizations(id uuid PRIMARY KEY, status text NOT NULL);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, alias text, role text NOT NULL);
    CREATE TABLE public.organization_members(
      organization_id uuid NOT NULL REFERENCES public.organizations(id),
      profile_id uuid NOT NULL REFERENCES public.profiles(id),
      PRIMARY KEY(organization_id,profile_id));
  `);
});

beforeEach(async () => {
  if (!client) throw new Error('Disposable mention fixture did not initialize');
  await client`TRUNCATE public.organization_members,public.profiles,public.organizations CASCADE`;
  await client`INSERT INTO public.organizations VALUES (${ORG},'active'),(${OTHER_ORG},'active')`;
  await client`INSERT INTO public.profiles VALUES
    (${ACTOR},NULL,'user'),(${PERSON},'colleague','user'),(${OUTSIDE_ADMIN},'private_other_org','admin')`;
  await client`INSERT INTO public.organization_members VALUES
    (${ORG},${ACTOR}),(${ORG},${PERSON}),(${OTHER_ORG},${PERSON}),(${OTHER_ORG},${OUTSIDE_ADMIN})`;
  boundary.pool.mockReturnValue(client);
  boundary.report.mockClear();
});

afterAll(async () => {
  try {
    await client?.end({ timeout: 5 });
    if (created && parent) {
      const [record] = await parent.owner`SELECT shobj_description(oid,'pg_database') AS marker
        FROM pg_database WHERE datname=${name}`;
      if (record?.marker !== marker) throw new Error('Mention fixture cleanup marker mismatch');
      await parent.owner.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      const remaining = await parent.owner`SELECT datname FROM pg_database WHERE datname=${name}`;
      expect(remaining).toHaveLength(0);
      process.stdout.write(
        JSON.stringify({
          fixture: name,
          databaseDropped: true,
          rolesCreated: 0,
          productionWrites: 0,
        }) + '\n',
      );
    }
  } finally {
    await parent?.close();
  }
});

describe('mention directory against PostgreSQL', () => {
  it('returns only exact organization members and echoes the admitted actor', async () => {
    expect(await listMentionDirectory(OWNER)).toEqual({
      ...OWNER,
      aliases: { [PERSON]: 'colleague' },
    });
  });

  it('does not treat platform-admin status as organization membership', async () => {
    await expect(listMentionDirectory({ ...OWNER, actorId: OUTSIDE_ADMIN })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects a revoked member and an inactive organization on the next request', async () => {
    await client!`DELETE FROM public.organization_members WHERE organization_id=${ORG} AND profile_id=${ACTOR}`;
    await expect(listMentionDirectory(OWNER)).rejects.toMatchObject({ status: 403 });
    await client!`INSERT INTO public.organization_members VALUES (${ORG},${ACTOR})`;
    await client!`UPDATE public.organizations SET status='disabled' WHERE id=${ORG}`;
    await expect(listMentionDirectory(OWNER)).rejects.toMatchObject({ status: 403 });
  });

  it('returns a genuine empty directory when current members have no aliases', async () => {
    await client!`UPDATE public.profiles SET alias=NULL WHERE id=${PERSON}`;
    expect(await listMentionDirectory(OWNER)).toEqual({ ...OWNER, aliases: {} });
  });

  it('rejects malformed or duplicate aliases without exposing raw storage details', async () => {
    await client!`UPDATE public.profiles SET alias='<private invalid alias>' WHERE id=${PERSON}`;
    await expect(listMentionDirectory(OWNER)).rejects.toMatchObject({
      status: 503,
      body: { message: 'Mention directory is temporarily unavailable.' },
    });
    expect(JSON.stringify(boundary.report.mock.calls)).not.toContain('private invalid alias');
    await client!`UPDATE public.profiles SET alias='same' WHERE id IN (${ACTOR},${PERSON})`;
    await expect(listMentionDirectory(OWNER)).rejects.toMatchObject({ status: 503 });
  });

  it('rejects overflow instead of returning a silently partial directory', async () => {
    await client!`INSERT INTO public.profiles
      SELECT ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'person_'||i,'user'
      FROM generate_series(1,10000) i`;
    await client!`INSERT INTO public.organization_members
      SELECT ${ORG}::uuid,id FROM public.profiles WHERE id::text LIKE '30000000-%'`;
    await expect(listMentionDirectory(OWNER)).rejects.toMatchObject({ status: 503 });
  });

  it('executes the production transaction read-only with repeatable-read and bounded statement timeout', async () => {
    const observed: unknown[] = [];
    boundary.pool.mockReturnValue({
      begin: (options: string, callback: (tx: postgres.TransactionSql) => Promise<unknown>) =>
        client!.begin(options, async (tx) => {
          const result = await callback(tx);
          const [settings] = await tx`SELECT current_setting('transaction_read_only') AS readonly,
          current_setting('transaction_isolation') AS isolation,current_setting('statement_timeout') AS timeout`;
          observed.push(settings);
          return result;
        }),
    });
    await listMentionDirectory(OWNER);
    expect(observed).toEqual([{ readonly: 'on', isolation: 'repeatable read', timeout: '5s' }]);
  });
});
