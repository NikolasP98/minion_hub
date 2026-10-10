import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASELINE,
  BOOKING_A,
  FIXTURES,
  LOG_A,
  MIGRATIONS,
  ORG_A,
  ORG_B,
  ROOT,
  RULE_A,
  TARGET_FILE,
  TARGET_VERSION,
  assertCanonicalCatalog,
  catalogDigest,
  createChild,
  dropChild,
  ensureFixtureRole,
  finalColumnNames,
  fixtureRolesCreated,
  harness,
  installLegacyState,
  installPrerequisites,
  quoteRoleIdentifier,
  restoreSupportedBaseline,
  runMigration,
  runMigrationStatus,
  seedLegacyRows,
  setupNotificationMigrationHarness,
  sha256,
  snapshotLegacyRows,
  teardownNotificationMigrationHarness,
  type LegacyState,
  type Sql,
} from '../../../tests/fixtures/notification-migrations/reconciliation-harness';
import {
  catalogMutationVectors,
  sourceMutationVectors,
} from '../../../tests/fixtures/notification-migrations/reconciliation-mutations';
import { readNotificationProjectionCatalog } from '../services/notifications/projection/catalog-admission';
import { notificationProjectionCatalogMatches } from '../services/notifications/projection/catalog-fingerprint';

const SLICE5_ENQUEUE_BODY = `
begin
  if tg_relid<>'public.notification_events'::regclass or tg_table_schema<>'public'
    or tg_table_name<>'notification_events' or tg_op<>'INSERT' or tg_when<>'AFTER' then
    raise exception 'Notification enqueue trigger source is invalid';
  end if;
  insert into public.notification_outbox(event_id,organization_id,catalog_revision,kind,schema_version)
    values(new.id,new.organization_id,new.catalog_revision,new.kind,new.schema_version);
  return new;
end `;

describe('notification legacy reconciliation against PostgreSQL', () => {
  beforeAll(setupNotificationMigrationHarness);
  afterAll(teardownNotificationMigrationHarness);

  it('uses exact frozen historical migration bytes and supported-baseline provenance', () => {
    const provenance = JSON.parse(readFileSync(join(FIXTURES, 'provenance.json'), 'utf8')) as {
      fixtures: Array<{ path: string; sha256: string }>;
      supportedBaseline: Record<string, string>;
    };
    expect(
      provenance.fixtures.map((fixture) => ({
        path: fixture.path,
        sha256: sha256(readFileSync(join(FIXTURES, fixture.path))),
      })),
    ).toEqual(provenance.fixtures.map(({ path, sha256: digest }) => ({ path, sha256: digest })));
    expect(sha256(readFileSync(join(ROOT, 'supabase', 'qa', 'baseline', 'schema.sql')))).toBe(
      provenance.supportedBaseline.schemaSha256,
    );
    expect(sha256(readFileSync(join(BASELINE, 'ledger.sql')))).toBe(
      provenance.supportedBaseline.ledgerSha256,
    );
    expect(sha256(readFileSync(join(BASELINE, 'baseline.json')))).toBe(
      provenance.supportedBaseline.metadataSha256,
    );
    expect(readFileSync(join(MIGRATIONS, TARGET_FILE), 'utf8')).toContain(
      'notification_schema_conflict',
    );
  });

  it('runs the production runner from fresh and every exact historical prefix while preserving old values', async () => {
    const states: LegacyState[] = [
      'fresh',
      'reminder_base',
      'reminder_multichannel',
      'reminder_inference',
      'legacy_complete',
    ];
    for (const state of states) {
      const child = await createChild(state);
      try {
        await installPrerequisites(child.db);
        await installLegacyState(child.db, state);
        await seedLegacyRows(child.db, state);
        const before = await snapshotLegacyRows(child.db, state);

        const result = runMigration(child.url);
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.code, `${state}: ${result.stderr}`).toBe(0);
        expect(result.stdout).toContain(`db:migrate — applying ${TARGET_VERSION}`);
        expect(
          await child.db`SELECT version FROM public.hub_migrations WHERE version=${TARGET_VERSION}`,
        ).toEqual([{ version: TARGET_VERSION }]);
        await assertCanonicalCatalog(child.db);

        if (before) {
          expect(
            await child.db.unsafe(
              `SELECT ${before.configColumns.map((column) => `"${column}"`).join(',')} FROM public.sched_reminder_config ORDER BY org_id`,
            ),
          ).toEqual(before.config);
          expect(
            await child.db.unsafe(
              `SELECT ${before.reminderColumns.map((column) => `"${column}"`).join(',')} FROM public.sched_reminders ORDER BY id`,
            ),
          ).toEqual(before.reminders);
          expect(
            await child.db`SELECT channels,infer_confirmation FROM public.sched_reminder_config`,
          ).toEqual([{ channels: [], infer_confirmation: false }]);
          expect(await child.db`SELECT recipient_role FROM public.sched_reminders`).toEqual([
            { recipient_role: 'client' },
          ]);
          if (state === 'legacy_complete') {
            expect(await child.db`SELECT * FROM public.notif_rules ORDER BY id`).toEqual(
              before.rules,
            );
            expect(await child.db`SELECT * FROM public.notif_log ORDER BY id`).toEqual(before.log);
          }
        }

        const digestBeforeRerun = await catalogDigest(child.db);
        const [ledgerBeforeRerun] = await child.db<
          { version: string; appliedAt: Date }[]
        >`SELECT version,applied_at AS "appliedAt" FROM public.hub_migrations
          WHERE version=${TARGET_VERSION}`;
        const rerun = runMigration(child.url);
        expect(rerun.code, `${state} rerun: ${rerun.stderr}`).toBe(0);
        expect(rerun.stdout).toContain('db:migrate — done (0 applied).');
        expect(
          await child.db`SELECT count(*)::int AS count FROM public.hub_migrations WHERE version=${TARGET_VERSION}`,
        ).toEqual([{ count: 1 }]);
        expect(await catalogDigest(child.db)).toBe(digestBeforeRerun);
        expect(
          await child.db`SELECT version,applied_at AS "appliedAt" FROM public.hub_migrations
            WHERE version=${TARGET_VERSION}`,
        ).toEqual([ledgerBeforeRerun]);
      } finally {
        await dropChild(child);
      }
    }
  }, 120_000);

  it('restores the supported QA baseline and reaches zero pending migrations through the production runner', async () => {
    const child = await createChild('supported-baseline');
    const laterRoleNames = [
      'notification_event_trigger',
      'notification_worker',
      'notification_coordinator',
      'notification_health_reader',
      'app_notification_worker',
      'notification_projection_owner_bridge',
      'notification_projection_finalizer',
    ];
    const rolesBefore = new Set(
      (
        await harness.owner<{ rolname: string }[]>`
          SELECT rolname FROM pg_roles WHERE rolname = ANY(${laterRoleNames})`
      ).map((row) => row.rolname),
    );
    try {
      await restoreSupportedBaseline(child);
      expect(
        await child.db`SELECT version FROM public.hub_migrations WHERE version=${TARGET_VERSION}`,
      ).toEqual([]);

      const result = runMigration(child.url);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain(`db:migrate — applying ${TARGET_VERSION}`);
      await assertCanonicalCatalog(child.db);
      const projectionCatalog = await child.db.begin((tx) => readNotificationProjectionCatalog(tx));
      expect(notificationProjectionCatalogMatches(projectionCatalog)).toBe(true);

      const [enqueue] = await child.db<
        {
          owner: string;
          securityDefiner: boolean;
          config: string[] | null;
          body: string;
          canCreate: boolean;
          bridge: string | null;
        }[]
      >`SELECT pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS "securityDefiner",
          p.proconfig AS config,p.prosrc AS body,
          has_schema_privilege('notification_event_trigger','public','CREATE') AS "canCreate",
          to_regrole('notification_projection_owner_bridge')::text AS bridge
        FROM pg_proc p WHERE p.oid='public.notification_event_enqueue()'::regprocedure`;
      expect(enqueue).toEqual({
        owner: 'notification_event_trigger',
        securityDefiner: true,
        config: ['search_path=""'],
        body: SLICE5_ENQUEUE_BODY,
        canCreate: false,
        bridge: null,
      });

      const organizationId = randomUUID();
      const eventId = randomUUID();
      const subjectId = randomUUID();
      await child.db`INSERT INTO public.organizations(id,name,slug,status)
        VALUES (${organizationId}::uuid,'Slice5 enqueue fixture',${`slice5-${organizationId}`},'active')`;
      await child.db.begin(async (tx) => {
        await tx`SELECT set_config('role','app_ledger',true),
          set_config('app.current_org_id',${organizationId},true)`;
        await tx`INSERT INTO public.notification_events(
            id,organization_id,kind,schema_version,catalog_revision,producer_id,subject_type,subject_id,
            subject_revision,source_identity,occurred_at,dedupe_key,payload_canonical,payload_sha256,
            semantic_sha256)
          VALUES (${eventId}::uuid,${organizationId}::uuid,'join.requested',1,'2026-10-03.1',
            'membership.join','join_request',${subjectId}::uuid,'fixture.1','fixture.source.1',
            clock_timestamp(),${`fixture.${eventId}`},'{}',encode(sha256(convert_to('{}','UTF8')),'hex'),
            repeat('0',64))`;
      });
      expect(
        await child.db`SELECT event_id,organization_id,catalog_revision,kind,schema_version,state,
            generation::text,claim_count
          FROM public.notification_outbox WHERE event_id=${eventId}::uuid`,
      ).toEqual([
        {
          event_id: eventId,
          organization_id: organizationId,
          catalog_revision: '2026-10-03.1',
          kind: 'join.requested',
          schema_version: 1,
          state: 'pending',
          generation: '0',
          claim_count: '0',
        },
      ]);

      const status = runMigrationStatus(child.url);
      expect(status.error).toBeUndefined();
      expect(status.signal).toBeNull();
      expect(status.status, status.stderr).toBe(0);
      expect(status.stdout).toContain('0 pending');
      expect(
        await child.db`SELECT count(*)::int AS count FROM public.hub_migrations
          WHERE version=${TARGET_VERSION}`,
      ).toEqual([{ count: 1 }]);
    } finally {
      const rolesAfter = await harness.owner<{ rolname: string }[]>`
        SELECT rolname FROM pg_roles WHERE rolname = ANY(${laterRoleNames})`;
      for (const { rolname } of rolesAfter) {
        if (!rolesBefore.has(rolname)) fixtureRolesCreated.add(rolname);
      }
      await dropChild(child);
    }
  }, 120_000);

  it('rejects a premarked but omitted reconciliation as noncanonical migration evidence', async () => {
    const child = await createChild('omitted-adoption');
    try {
      await installPrerequisites(child.db);
      await child.db`INSERT INTO public.hub_migrations(version) VALUES (${TARGET_VERSION})`;
      const result = runMigration(child.url);
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain('db:migrate — done (0 applied).');
      expect(
        await child.db`SELECT count(*)::int AS count FROM pg_class c
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname = ANY(${Object.keys(finalColumnNames)})`,
      ).toEqual([{ count: 0 }]);
      await expect(assertCanonicalCatalog(child.db)).rejects.toThrow();
    } finally {
      await dropChild(child);
    }
  }, 30_000);

  it('rejects altered catalogs and rows transactionally with a bounded conflict', async () => {
    const mutations = catalogMutationVectors;

    for (const mutation of mutations) {
      const child = await createChild(mutation.name.replaceAll(' ', '-'));
      try {
        await installPrerequisites(child.db);
        const state = mutation.state ?? 'legacy_complete';
        await installLegacyState(child.db, state);
        await seedLegacyRows(child.db, state);
        if (mutation.reason === 'orphan_booking') {
          const fixtureAdmin = postgres(child.adminUrl.href, { max: 1, prepare: false });
          try {
            await fixtureAdmin.unsafe(mutation.sql);
          } finally {
            await fixtureAdmin.end({ timeout: 5 });
          }
        } else {
          await child.db.unsafe(mutation.sql);
        }
        const before = await catalogDigest(child.db);
        const result = runMigration(child.url);
        expect(result.code, mutation.name).toBe(1);
        expect(result.stderr).toContain(`notification_schema_conflict:${mutation.reason}`);
        expect(result.stderr).not.toContain('fixture@example.invalid');
        expect(result.stderr).not.toContain(ORG_A);
        if (['reminder_state', 'notification_state', 'orphan_booking'].includes(mutation.reason)) {
          expect(result.stderr).toContain('count=1');
        }
        expect(
          await child.db`SELECT version FROM public.hub_migrations WHERE version=${TARGET_VERSION}`,
        ).toEqual([]);
        expect(await catalogDigest(child.db)).toBe(before);
      } finally {
        await dropChild(child);
      }
    }
  }, 120_000);

  it('kills classifier, ACL, FORCE-RLS, and transition-trigger source mutants transactionally', async () => {
    const source = readFileSync(join(MIGRATIONS, TARGET_FILE), 'utf8');
    const mutations = sourceMutationVectors(source);

    for (const mutation of mutations) {
      const child = await createChild(`mutant-${mutation.name}`);
      try {
        await installPrerequisites(child.db);
        await installLegacyState(child.db, mutation.state);
        await seedLegacyRows(child.db, mutation.state);
        if (mutation.prepare) await child.db.unsafe(mutation.prepare);
        const before = await catalogDigest(child.db);
        let failure: unknown;
        try {
          await child.db.begin(async (tx) => tx.unsafe(mutation.source));
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(
          `notification_schema_conflict:${mutation.finalReason}`,
        );
        expect((failure as Error).message).not.toContain(ORG_A);
        expect(await catalogDigest(child.db)).toBe(before);
      } finally {
        await dropChild(child);
      }
    }
  }, 90_000);

  it('rejects a transitive app-ledger membership without mutating the cluster role graph', async () => {
    const child = await createChild('membership-edge');
    const role = `minion_notification_membership_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    try {
      await installPrerequisites(child.db);
      await installLegacyState(child.db, 'legacy_complete');
      await seedLegacyRows(child.db, 'legacy_complete');
      await ensureFixtureRole(role, 'NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS');
      await harness.owner.unsafe(`GRANT app_ledger TO ${quoteRoleIdentifier(role)}`);
      await harness.owner.unsafe(`GRANT ${quoteRoleIdentifier(role)} TO app_assistant_ro`);
      const before = await harness.owner<{ member: boolean; usage: boolean }[]>`
        SELECT pg_has_role('app_assistant_ro','app_ledger','MEMBER') AS member,
          pg_has_role('app_assistant_ro','app_ledger','USAGE') AS usage`;
      // app_assistant_ro is NOINHERIT, so USAGE remains false; MEMBER proves it
      // can still traverse the edge with SET ROLE, which the classifier must reject.
      expect(before).toEqual([{ member: true, usage: false }]);
      const digest = await catalogDigest(child.db);

      const result = runMigration(child.url);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('notification_schema_conflict:role_membership');
      expect(result.stderr).not.toContain(ORG_A);
      expect(await catalogDigest(child.db)).toBe(digest);
      expect(
        await child.db`SELECT version FROM public.hub_migrations WHERE version=${TARGET_VERSION}`,
      ).toEqual([]);
      expect(
        await harness.owner`
          SELECT pg_has_role('app_assistant_ro','app_ledger','MEMBER') AS member,
            pg_has_role('app_assistant_ro','app_ledger','USAGE') AS usage`,
      ).toEqual(before);
    } finally {
      if (fixtureRolesCreated.has(role)) {
        await harness.owner.unsafe(`REVOKE ${quoteRoleIdentifier(role)} FROM app_assistant_ro`);
        await harness.owner.unsafe(`REVOKE app_ledger FROM ${quoteRoleIdentifier(role)}`);
        await harness.owner.unsafe(`DROP ROLE ${quoteRoleIdentifier(role)}`);
        fixtureRolesCreated.delete(role);
      }
      await dropChild(child);
    }
  }, 60_000);

  it('enforces exact app-ledger ACLs and organization RLS across independent sessions', async () => {
    const child = await createChild('acl-rls');
    const probeRole = `minion_notification_public_probe_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const sessions: Sql[] = [];
    try {
      await installPrerequisites(child.db);
      const migration = runMigration(child.url);
      expect(migration.code, migration.stderr).toBe(0);
      await assertCanonicalCatalog(child.db);

      const sessionA = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => {} });
      const sessionB = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => {} });
      sessions.push(sessionA, sessionB);
      const insertConfig = async (session: Sql, orgId: string) =>
        session.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true)`;
          await tx`SELECT set_config('app.current_org_id',${orgId},true)`;
          return tx`INSERT INTO public.sched_reminder_config(org_id) VALUES (${orgId})
            RETURNING org_id`;
        });
      expect(await insertConfig(sessionA, ORG_A)).toEqual([{ org_id: ORG_A }]);
      expect(await insertConfig(sessionB, ORG_B)).toEqual([{ org_id: ORG_B }]);

      const readAs = async (session: Sql, orgId: string | null) =>
        session.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true)`;
          if (orgId !== null) await tx`SELECT set_config('app.current_org_id',${orgId},true)`;
          return tx<{ org_id: string }[]>`
            SELECT org_id FROM public.sched_reminder_config ORDER BY org_id`;
        });
      expect(await readAs(sessionA, ORG_A)).toEqual([{ org_id: ORG_A }]);
      expect(await readAs(sessionB, ORG_B)).toEqual([{ org_id: ORG_B }]);
      expect(await readAs(sessionA, 'wrong-org')).toEqual([]);
      expect(await readAs(sessionB, '')).toEqual([]);
      expect(await readAs(sessionA, null)).toEqual([]);

      await expect(
        sessionA.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true)`;
          await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
          return tx`INSERT INTO public.sched_reminder_config(org_id) VALUES (${ORG_B})`;
        }),
      ).rejects.toMatchObject({ code: '42501' });
      expect(
        await sessionA.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true)`;
          await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
          return tx`UPDATE public.sched_reminder_config SET enabled=true
            WHERE org_id=${ORG_B} RETURNING org_id`;
        }),
      ).toEqual([]);
      expect(
        await sessionA.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true)`;
          await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
          return tx`DELETE FROM public.sched_reminder_config WHERE org_id=${ORG_B}
            RETURNING org_id`;
        }),
      ).toEqual([]);

      const roleFlags = await child.db<
        { login: boolean; super: boolean; bypass: boolean; owns: boolean }[]
      >`
        SELECT r.rolcanlogin AS login,r.rolsuper AS super,r.rolbypassrls AS bypass,
          EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname = ANY(${Object.keys(finalColumnNames)})
              AND c.relowner=r.oid) AS owns
        FROM pg_roles r WHERE r.rolname='app_ledger'`;
      expect(roleFlags).toEqual([{ login: false, super: false, bypass: false, owns: false }]);

      const directPrivileges = await child.db<{ table: string; privileges: string[] }[]>`
        SELECT c.relname AS table,
          array_agg(x.privilege_type ORDER BY x.privilege_type) AS privileges
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
        WHERE c.relname = ANY(${Object.keys(finalColumnNames)})
          AND x.grantee=to_regrole('app_ledger')
        GROUP BY c.relname ORDER BY c.relname`;
      expect(directPrivileges).toEqual([
        { table: 'notif_log', privileges: ['INSERT', 'SELECT'] },
        { table: 'notif_rules', privileges: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] },
        {
          table: 'sched_reminder_config',
          privileges: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        },
        { table: 'sched_reminders', privileges: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] },
      ]);
      expect(
        await child.db`
          SELECT c.relname,x.privilege_type
          FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
          WHERE c.relname = ANY(${Object.keys(finalColumnNames)}) AND x.grantee=0`,
      ).toEqual([]);
      expect(
        await child.db`SELECT c.relname,a.attname
          FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
          WHERE c.relname = ANY(${Object.keys(finalColumnNames)}) AND a.attacl IS NOT NULL`,
      ).toEqual([]);

      for (const role of ['anon', 'authenticated', 'service_role', 'app_assistant_ro']) {
        const [{ anyTable, anyColumn, ledgerMember, ledgerUsage }] = await child.db<
          {
            anyTable: boolean;
            anyColumn: boolean;
            ledgerMember: boolean;
            ledgerUsage: boolean;
          }[]
        >`
          SELECT
            EXISTS (SELECT 1 FROM unnest(${Object.keys(finalColumnNames)}::text[]) table_name
              WHERE has_any_column_privilege(${role},format('public.%I',table_name),'SELECT,INSERT,UPDATE,REFERENCES')
                OR has_table_privilege(${role},format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS "anyTable",
            EXISTS (SELECT 1 FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
              WHERE c.relname = ANY(${Object.keys(finalColumnNames)}) AND a.attnum>0
                AND has_column_privilege(${role},c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES')) AS "anyColumn",
            pg_has_role(${role},'app_ledger','MEMBER') AS "ledgerMember",
            pg_has_role(${role},'app_ledger','USAGE') AS "ledgerUsage"`;
        expect({ role, anyTable, anyColumn, ledgerMember, ledgerUsage }).toEqual({
          role,
          anyTable: false,
          anyColumn: false,
          ledgerMember: false,
          ledgerUsage: false,
        });
      }

      await ensureFixtureRole(probeRole, 'NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS');
      const [publicProbe] = await child.db<{ tablePrivilege: boolean; columnPrivilege: boolean }[]>`
        SELECT
          EXISTS (SELECT 1 FROM unnest(${Object.keys(finalColumnNames)}::text[]) table_name
            WHERE has_table_privilege(${probeRole},format('public.%I',table_name),'SELECT'))
              AS "tablePrivilege",
          EXISTS (SELECT 1 FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
            WHERE c.relname = ANY(${Object.keys(finalColumnNames)}) AND a.attnum>0
              AND has_column_privilege(${probeRole},c.oid,a.attnum,'SELECT'))
              AS "columnPrivilege"`;
      expect(publicProbe).toEqual({ tablePrivilege: false, columnPrivilege: false });
    } finally {
      await Promise.all(sessions.map((session) => session.end({ timeout: 5 })));
      if (fixtureRolesCreated.has(probeRole)) {
        await harness.owner.unsafe(`DROP ROLE ${quoteRoleIdentifier(probeRole)}`);
        fixtureRolesCreated.delete(probeRole);
      }
      await dropChild(child);
    }
  }, 90_000);

  it('allows only sending-to-terminal reminder transitions and preserves immutable identity', async () => {
    const child = await createChild('reminder-transitions');
    const session = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await installPrerequisites(child.db);
      const migration = runMigration(child.url);
      expect(migration.code, migration.stderr).toBe(0);
      await child.db`INSERT INTO public.sched_bookings(id,org_id) VALUES (${BOOKING_A},${ORG_A})`;

      const asLedger = <T>(operation: (tx: Sql) => Promise<T>) =>
        session.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true)`;
          await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
          return operation(tx as unknown as Sql);
        });
      const ids = {
        sent: '20000000-0000-4000-8000-000000000011',
        failed: '20000000-0000-4000-8000-000000000012',
        skipped: '20000000-0000-4000-8000-000000000013',
        mutable: '20000000-0000-4000-8000-000000000014',
        deleted: '20000000-0000-4000-8000-000000000015',
      } as const;
      let stage = 0;
      for (const id of Object.values(ids)) {
        stage++;
        await asLedger(
          (tx) =>
            tx`INSERT INTO public.sched_reminders
            (id,org_id,booking_id,stage,channel,recipient,status)
            VALUES (${id},${ORG_A},${BOOKING_A},${`stage-${stage}`},'email',
              'fixture@example.invalid','sending')`,
        );
      }

      expect(
        await asLedger(
          (tx) =>
            tx`UPDATE public.sched_reminders SET status='sent',sent_at='2026-01-02T05:00:00Z',
            message_id='fixture-message',content='settled content'
            WHERE id=${ids.sent} RETURNING status,sent_at IS NOT NULL AS "hasSentAt"`,
        ),
      ).toEqual([{ status: 'sent', hasSentAt: true }]);
      expect(
        await asLedger(
          (tx) =>
            tx`UPDATE public.sched_reminders SET status='failed',error='fixture failure'
            WHERE id=${ids.failed} RETURNING status,sent_at`,
        ),
      ).toEqual([{ status: 'failed', sent_at: null }]);
      expect(
        await asLedger(
          (tx) =>
            tx`UPDATE public.sched_reminders SET status='skipped',content='fixture skipped'
            WHERE id=${ids.skipped} RETURNING status,sent_at`,
        ),
      ).toEqual([{ status: 'skipped', sent_at: null }]);

      for (const operation of [
        () =>
          asLedger(
            (tx) =>
              tx`UPDATE public.sched_reminders SET status='sending',sent_at=NULL
              WHERE id=${ids.sent}`,
          ),
        () =>
          asLedger(
            (tx) =>
              tx`UPDATE public.sched_reminders SET status='failed',sent_at=NULL
              WHERE id=${ids.sent}`,
          ),
        () =>
          asLedger(
            (tx) =>
              tx`INSERT INTO public.sched_reminders
              (id,org_id,booking_id,stage,channel,status,sent_at)
              VALUES ('20000000-0000-4000-8000-000000000016',${ORG_A},${BOOKING_A},
                'direct-sent','email','sent','2026-01-02T05:01:00Z')`,
          ),
        () =>
          asLedger(
            (tx) =>
              tx`UPDATE public.sched_reminders SET org_id=${ORG_B}
              WHERE id=${ids.mutable}`,
          ),
        () =>
          asLedger(
            (tx) =>
              tx`UPDATE public.sched_reminders SET status='unknown'
              WHERE id=${ids.mutable}`,
          ),
        () =>
          asLedger(
            (tx) =>
              tx`UPDATE public.sched_reminders SET status='sent',sent_at=NULL
              WHERE id=${ids.mutable}`,
          ),
      ]) {
        await expect(operation()).rejects.toMatchObject({ code: '23514' });
      }

      expect(
        await asLedger(
          (tx) => tx`DELETE FROM public.sched_reminders WHERE id=${ids.deleted} RETURNING id`,
        ),
      ).toEqual([{ id: ids.deleted }]);
      expect(
        await child.db`SELECT id,org_id,booking_id,stage,channel,recipient,created_at
          FROM public.sched_reminders WHERE id=${ids.sent}`,
      ).toHaveLength(1);
      expect(
        await child.db`SELECT has_function_privilege('app_ledger',
          'public.enforce_sched_reminder_transition()','EXECUTE') AS allowed`,
      ).toEqual([{ allowed: false }]);
    } finally {
      await session.end({ timeout: 5 });
      await dropChild(child);
    }
  }, 60_000);

  it('keeps legacy sent rows as immutable claims without creating delivery effects', async () => {
    const child = await createChild('legacy-claim');
    const session = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await installPrerequisites(child.db);
      const migration = runMigration(child.url);
      expect(migration.code, migration.stderr).toBe(0);
      await session.begin(async (tx) => {
        await tx`SELECT set_config('role','app_ledger',true)`;
        await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
        await tx`INSERT INTO public.notif_log
          (id,org_id,rule_id,entity_id,trigger_key,channel,recipient,content,status,message_id)
          VALUES (${LOG_A},${ORG_A},${RULE_A},'fixture-entity','fixture-trigger','email',
            'fixture@example.invalid','legacy content','sent','legacy-message')`;
      });
      expect(
        await session.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true)`;
          await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
          return tx`SELECT id,status FROM public.notif_log WHERE id=${LOG_A}`;
        }),
      ).toEqual([{ id: LOG_A, status: 'sent' }]);
      await expect(
        session.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true)`;
          await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
          return tx`UPDATE public.notif_log SET status='failed' WHERE id=${LOG_A}`;
        }),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        session.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true)`;
          await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
          return tx`DELETE FROM public.notif_log WHERE id=${LOG_A}`;
        }),
      ).rejects.toMatchObject({ code: '42501' });
      expect(
        await child.db<{ relname: string }[]>`
          SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')
            AND (c.relname LIKE 'notif_%' OR c.relname LIKE 'notification_%')
          ORDER BY relname`,
      ).toEqual([{ relname: 'notif_log' }, { relname: 'notif_rules' }]);
      expect(
        await child.db`SELECT obj_description('public.notif_log'::regclass,'pg_class') AS comment`,
      ).toEqual([
        {
          comment: 'Legacy notification claims. Rows are not provider delivery receipts.',
        },
      ]);
    } finally {
      await session.end({ timeout: 5 });
      await dropChild(child);
    }
  }, 60_000);
});
