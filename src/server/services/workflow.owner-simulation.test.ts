import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { runWithEffectiveAuthority } from '$server/auth/effective-authority';
import { buildCapabilities } from './rbac.service';
import { applyTransition, statusChangeBlocked } from './workflow.service';
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (
    scope: { db: ReturnType<typeof drizzle> },
    fn: Parameters<ReturnType<typeof drizzle>['transaction']>[0],
  ) => scope.db.transaction(fn),
}));
const org = 'native-org',
  actorId = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002';
const own = '20000000-0000-4000-8000-000000000001',
  foreign = '20000000-0000-4000-8000-000000000002';
const actor = { id: actorId, role: 'user', name: 'Actual actor' };
const rules = ['sales', 'support'].map((module) => ({
  role_key: 'custom-scoped',
  module,
  can_view: true,
  can_create: true,
  can_edit: true,
  can_delete: false,
  can_export: false,
  can_manage: false,
  if_owner: true,
}));
const authority = {
  orgId: org,
  profileId: actorId,
  roleKey: 'custom-scoped',
  rank: 40,
  generation: '30000000-0000-4000-8000-000000000001',
  invalid: false,
  capabilities: buildCapabilities(['custom-scoped'], rules),
};
let client: PGlite, ctx: Parameters<typeof applyTransition>[0];
beforeAll(async () => {
  client = new PGlite();
  ctx = { db: drizzle(client), tenantId: org, profileId: actorId } as never;
  await client.exec(`create table workflow_defs(id uuid default gen_random_uuid(),org_id text,doc_type text,name text,enabled boolean,states jsonb,transitions jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
 create table sales_orders(id uuid,org_id text,status text,owner_id uuid);
 create table support_issues(id uuid,org_id text,status text,owner_id uuid);
 create table doc_audit_log(id uuid default gen_random_uuid(),org_id text,ref_type text,ref_id uuid,actor_id uuid,actor_name text,op text,changes jsonb,occurred_at timestamptz default now(),simulation_role_key text,simulation_generation uuid);`);
});
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  await client.exec(
    'delete from workflow_defs;delete from sales_orders;delete from support_issues;delete from doc_audit_log;',
  );
  for (const table of ['sales_orders', 'support_issues'])
    await client.query(
      `insert into ${table}(id,org_id,status,owner_id) values($1,$2,'draft',$3),($4,$2,'draft',$5)`,
      [own, org, actorId, foreign, other],
    );
});
describe('owner-scoped simulation workflows', () => {
  it.each(['sales_order', 'support_issue'])(
    'denies foreign status PATCH admission even without a workflow: %s',
    async (docType) => {
      await runWithEffectiveAuthority(authority, async () => {
        expect(await statusChangeBlocked(ctx, docType, foreign, 'done', actor)).toBe(true);
        expect(await statusChangeBlocked(ctx, docType, own, 'done', actor)).toBe(false);
      });
    },
  );
  it('permits owned real transition, denies foreign transition, and attributes actual person', async () => {
    await client.query(
      `insert into workflow_defs(org_id,doc_type,name,enabled,states,transitions) values($1,'sales_order','Approval',true,'[]',$2::jsonb)`,
      [org, JSON.stringify([{ from: 'draft', to: 'done', action: 'Approve' }])],
    );
    await runWithEffectiveAuthority(authority, async () => {
      expect(await applyTransition(ctx, 'sales_order', foreign, 'Approve', actor)).toBe(
        'not_found',
      );
      expect(await applyTransition(ctx, 'sales_order', own, 'Approve', actor)).toBe('ok');
    });
    expect(
      (await client.query<{ status: string }>('select status from sales_orders where id=$1', [own]))
        .rows[0]?.status,
    ).toBe('done');
    expect(
      (
        await client.query<{ status: string }>('select status from sales_orders where id=$1', [
          foreign,
        ])
      ).rows[0]?.status,
    ).toBe('draft');
    expect((await client.query('select actor_id,ref_id from doc_audit_log')).rows).toEqual([
      { actor_id: actorId, ref_id: own },
    ]);
  });
  it('rolls back the workflow mutation when its audit insert fails', async () => {
    await client.query(
      `insert into workflow_defs(org_id,doc_type,name,enabled,states,transitions) values($1,'sales_order','Approval',true,'[]',$2::jsonb)`,
      [org, JSON.stringify([{ from: 'draft', to: 'done', action: 'Approve' }])],
    );
    await client.exec(
      "create function reject_workflow_audit() returns trigger language plpgsql as $$begin raise exception 'test audit rejection';end$$; create trigger reject_workflow_audit before insert on doc_audit_log for each row execute function reject_workflow_audit();",
    );
    try {
      await expect(
        runWithEffectiveAuthority(authority, () =>
          applyTransition(ctx, 'sales_order', own, 'Approve', actor),
        ),
      ).rejects.toThrow();
      expect(
        (
          await client.query<{ status: string }>('select status from sales_orders where id=$1', [
            own,
          ])
        ).rows[0]?.status,
      ).toBe('draft');
    } finally {
      await client.exec(
        'drop trigger reject_workflow_audit on doc_audit_log;drop function reject_workflow_audit();',
      );
    }
  });
});
