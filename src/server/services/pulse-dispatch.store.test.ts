import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { applyHubMigration } from '../../../scripts/db-migrate-core';
import { redactExpiredPulsePayloadsTx } from './pulse-dispatch.store';
import { seed as seedPulse } from '../../../scripts/qa/seed/pulse';
import { openPulsePostgres } from '../test-utils/pulse-postgres';
import {
  businessTableQueryText,
  businessTableIdentityQueryText,
  getBusinessKnowledgeDomain,
  requiredColumnsForBusinessTable,
} from './brain-business-corpus.service';
let fixture: Awaited<ReturnType<typeof openPulsePostgres>>;
const org = '10000000-0000-4000-8000-000000000001';
const profile = '20000000-0000-4000-8000-000000000001';
const gateway = '30000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  fixture = await openPulsePostgres();
});
afterAll(async () => {
  await fixture?.close();
});
async function seed() {
  const proposal = randomUUID(),
    dispatch = randomUUID(),
    job = randomUUID();
  await fixture.pg`insert into pulse_proposals(id,org_id,source,kind,title,dedup_key,status,owner_profile_id) values(${proposal},${org},'fixture','reminder','Reviewed',${proposal},'approved',${profile})`;
  await fixture.pg`insert into bg_jobs(id,tenant_id,user_id,type,ref_id,created_at,updated_at) values(${job},${org},${profile},'pulse_dispatch',${dispatch},1,1)`;
  return { proposal, dispatch, job };
}
async function insert(
  ids: Awaited<ReturnType<typeof seed>>,
  actor = profile,
  createdAt = new Date().toISOString(),
) {
  return fixture.pg`insert into pulse_dispatches(id,org_id,proposal_id,proposal_revision,actor_profile_id,gateway_id,channel,agent_id,origin_session_key,action_kind,payload,payload_hash,tool_schema_revision,authority_snapshot_hash,gateway_qualification_revision,bg_job_id,created_at) values(${ids.dispatch},${org},${ids.proposal},1,${actor},${gateway},'prd','personal-fixture','agent:personal-fixture:main','reminder','{}','hash','fixture','authority','qualification',${ids.job},${createdAt}::timestamptz)`;
}
describe('actual Pulse migration and restricted owner storage', () => {
  it('excludes every owner-bound proposal from shared corpus content and identity even for its owner', async () => {
    const tenant = randomUUID();
    const own = randomUUID(),
      other = randomUUID(),
      legacy = randomUUID();
    const secondOwner = randomUUID();
    await fixture.pg`insert into pulse_proposals(id,org_id,source,kind,title,summary,dedup_key,owner_profile_id) values
      (${own},${tenant},'fixture','fyi','Private owner one','Secret owner one',${own},${profile}),
      (${other},${tenant},'fixture','fyi','Private owner two','Secret owner two',${other},${secondOwner}),
      (${legacy},${tenant},'fixture','fyi','Shared legacy','Shared summary',${legacy},null)`;
    const definition = getBusinessKnowledgeDomain('pulse').tables[0];
    expect(requiredColumnsForBusinessTable(definition)).toContain('owner_profile_id');
    for (const actor of [profile, secondOwner]) {
      await fixture.pg.begin(async (tx) => {
        await tx`select set_config('role','app_ledger',true),set_config('app.current_org_id',${tenant},true),set_config('app.current_profile_id',${actor},true)`;
        const [role] =
          await tx`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
        expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
        const content = await tx.unsafe(businessTableQueryText(definition));
        const identities = await tx.unsafe(businessTableIdentityQueryText(definition));
        expect(content).toHaveLength(1);
        expect(content[0]).toMatchObject({
          external_id: `pulse_proposals:${legacy}`,
          title: 'Shared legacy',
          payload: { summary: 'Shared summary' },
        });
        expect(identities).toEqual([{ external_id: `pulse_proposals:${legacy}` }]);
      });
    }
  });
  it('runs actual paired QA seed twice without replacing immutable decisions or duplicating receipts', async () => {
    const registrations: string[] = [];
    const context = {
      sql: fixture.pg,
      register: (id: string) => {
        registrations.push(id);
      },
    };
    await seedPulse(context);
    await seedPulse(context);
    expect(registrations).toHaveLength(20);
    const [counts] =
      await fixture.pg`select (select count(*)::int from pulse_proposals where source='qa') as proposals,(select count(*)::int from pulse_dispatches where gateway_qualification_revision='qa-disabled') as dispatches`;
    expect(counts).toEqual({ proposals: 5, dispatches: 1 });
  });
  it('reruns actual migration without inventing legacy decisions or revision history', async () => {
    const id = randomUUID();
    await fixture.pg`insert into pulse_proposals(id,org_id,source,kind,title,dedup_key) values(${id},${org},'fixture','fyi','Legacy',${id})`;
    expect(await fixture.migrate()).toBe(false);
    expect(await fixture.migrate()).toBe(false);
    await fixture.rerunSql();
    await fixture.rerunSql();
    const [ledger] =
      await fixture.pg`select count(*)::int as n from hub_migrations where version='20261023010000'`;
    expect(ledger.n).toBe(1);
    const [row] =
      await fixture.pg`select revision,owner_profile_id,decided_at from pulse_proposals where id=${id}`;
    expect(row).toEqual({ revision: 1, owner_profile_id: null, decided_at: null });
  });
  it('uses the actual CLI migration core for independent-connection lock dedupe and rollback', async () => {
    const body = 'create table pulse_fixture_migration_once(id integer primary key)';
    const results = await Promise.all(
      [fixture.pg, fixture.peer].map((connection) =>
        applyHubMigration(connection, {
          version: 'fixture-concurrent',
          body,
          ledgerSchema: fixture.schema,
        }),
      ),
    );
    expect(results.sort()).toEqual([false, true]);
    await expect(
      applyHubMigration(fixture.pg, {
        version: 'fixture-failed',
        body: 'create table pulse_fixture_rollback(id integer); select 1/0;',
        ledgerSchema: fixture.schema,
      }),
    ).rejects.toThrow();
    const [row] =
      await fixture.pg`select to_regclass('pulse_fixture_rollback') as target,(select count(*)::int from hub_migrations where version='fixture-failed') as ledger`;
    expect(row).toEqual({ target: null, ledger: 0 });
    await expect(
      applyHubMigration(fixture.pg, {
        version: 'invalid',
        body: 'select 1',
        ledgerSchema: 'public;drop schema public',
      }),
    ).rejects.toThrow('Invalid migration ledger schema');
  });
  it('constrains unique revision/job binding, admission, immutable content and tombstone deletion', async () => {
    const ids = await seed();
    await insert(ids);
    await expect(insert({ ...ids, dispatch: randomUUID() })).rejects.toThrow();
    await expect(
      fixture.pg`update pulse_proposals set payload='{"changed":true}' where id=${ids.proposal}`,
    ).rejects.toThrow();
    await expect(
      fixture.pg`update pulse_dispatches set state='scheduled' where id=${ids.dispatch}`,
    ).rejects.toThrow();
    await expect(
      fixture.pg`update pulse_dispatches set attempt_count=4 where id=${ids.dispatch}`,
    ).rejects.toThrow();
    await fixture.pg`update pulse_dispatches set state='admitted',admitted_at=now(),admitted_generation=1 where id=${ids.dispatch}`;
    await expect(
      fixture.pg`update pulse_dispatches set state='scheduled' where id=${ids.dispatch}`,
    ).rejects.toThrow();
    await expect(
      fixture.pg`update pulse_dispatches set state='indeterminate' where id=${ids.dispatch}`,
    ).rejects.toThrow();
    await expect(
      fixture.pg`update pulse_dispatches set state='queued' where id=${ids.dispatch}`,
    ).rejects.toThrow();
    await expect(
      fixture.pg`delete from pulse_dispatches where id=${ids.dispatch}`,
    ).rejects.toThrow();
    await expect(
      fixture.pg`delete from pulse_proposals where id=${ids.proposal}`,
    ).rejects.toThrow();
    await expect(fixture.pg`delete from bg_jobs where id=${ids.job}`).rejects.toThrow();
    await fixture.pg`update pulse_dispatches set state='indeterminate',safe_reason='admission_reclaimed' where id=${ids.dispatch}`;
  });
  it('detects the old mutable-approved-content counterexample when its actual SQL guard is deliberately removed', async () => {
    const ids = await seed();
    await insert(ids);
    await expect(
      fixture.pg.begin(async (tx) => {
        await tx.unsafe('alter table pulse_proposals disable trigger pulse_proposal_immutable');
        const changed =
          await tx`update pulse_proposals set payload='{"unsafe_old_behavior":true}' where id=${ids.proposal} returning payload`;
        expect(changed[0].payload).toEqual({ unsafe_old_behavior: true });
        throw new Error('rollback controlled negative fixture');
      }),
    ).rejects.toThrow('rollback controlled negative fixture');
    await expect(
      fixture.pg`update pulse_proposals set payload='{"unsafe_old_behavior":true}' where id=${ids.proposal}`,
    ).rejects.toThrow();
  });
  it('FORCE RLS enforces org AND owner under the effective app role', async () => {
    const ids = await seed();
    await insert(ids);
    const query = (actor: string, tenant = org) =>
      fixture.pg.begin(async (tx) => {
        await tx`select set_config('role','app_ledger',true),set_config('app.current_org_id',${tenant},true),set_config('app.current_profile_id',${actor},true)`;
        const [identity] = await tx`select current_user as role`;
        expect(identity.role).toBe('app_ledger');
        return tx`select id from pulse_dispatches where id=${ids.dispatch}`;
      });
    expect(await query(profile)).toHaveLength(1);
    expect(await query('other-owner')).toHaveLength(0);
    expect(await query(profile, 'other-org')).toHaveLength(0);
    const [flags] =
      await fixture.pg`select relrowsecurity,relforcerowsecurity from pg_class where oid='pulse_dispatches'::regclass`;
    expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    await expect(
      fixture.pg.begin(async (tx) => {
        await tx`set local role app_ledger`;
        await tx`delete from pulse_dispatches`;
      }),
    ).rejects.toThrow();
  });
  it('retention fences expired queued work and irreversibly redacts only payload while retaining the tombstone', async () => {
    const ids = await seed();
    await insert(ids, profile, new Date(Date.now() - 31 * 86400000).toISOString());
    const redacted = await fixture.db.transaction((tx) =>
      redactExpiredPulsePayloadsTx(tx, { tenantId: org, profileId: profile }),
    );
    expect(redacted).toBe(1);
    const [row] =
      await fixture.pg`select state,payload,payload_hash,payload_redacted_at from pulse_dispatches where id=${ids.dispatch}`;
    expect(row.state).toBe('canceled');
    expect(row.payload).toBeNull();
    expect(row.payload_hash).toBe('hash');
    expect(row.payload_redacted_at).not.toBeNull();
    const [job] = await fixture.pg`select status,lease_generation from bg_jobs where id=${ids.job}`;
    expect(job).toEqual({ status: 'cancelled', lease_generation: 1 });
    await expect(
      fixture.pg`update pulse_dispatches set payload='{}',payload_redacted_at=null where id=${ids.dispatch}`,
    ).rejects.toThrow();
    await expect(
      fixture.pg`update pulse_dispatches set id=${randomUUID()} where id=${ids.dispatch}`,
    ).rejects.toThrow();
    expect(
      await fixture.db.transaction((tx) =>
        redactExpiredPulsePayloadsTx(tx, { tenantId: org, profileId: profile }),
      ),
    ).toBe(0);
  });
  it('rejects mismatched job owner and scoped proposal reference', async () => {
    const ids = await seed();
    await expect(insert(ids, 'another-profile')).rejects.toThrow();
    await fixture.pg`update bg_jobs set tenant_id='wrong' where id=${ids.job}`;
    await expect(insert(ids)).rejects.toThrow();
  });
});
