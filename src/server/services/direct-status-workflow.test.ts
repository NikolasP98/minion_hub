import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { runWithEffectiveAuthority } from '$server/auth/effective-authority';
import { salesOrders } from '$server/db/pg-sales-schema';
import { supportIssues } from '$server/db/pg-support-schema';
import { workflowDefs } from '$server/db/pg-workflow-schema';
import { docAuditLog } from '$server/db/pg-activity-schema';
import { buildCapabilities } from './rbac.service';
import { setOrderStatus } from './sales.service';
import { updateIssue } from './support.service';
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (
    scope: { db: ReturnType<typeof drizzle> },
    fn: Parameters<ReturnType<typeof drizzle>['transaction']>[0],
  ) => scope.db.transaction(fn),
}));
vi.mock('$server/events/emit', () => ({ emitHubEvent: vi.fn(async () => {}) }));
const org = 'workflow-org',
  id = '10000000-0000-4000-8000-000000000001',
  actorId = '20000000-0000-4000-8000-000000000001';
const actor = { id: actorId, name: 'Actual actor' },
  workflowActor = { ...actor, role: 'staff' };
const dialect = new PgDialect();
let client: PGlite, ctx: CoreCtx;
const tables: PgTable[] = [salesOrders, supportIssues, workflowDefs, docAuditLog];
beforeAll(async () => {
  client = new PGlite();
  ctx = { db: drizzle(client), tenantId: org, profileId: actorId } as unknown as CoreCtx;
  for (const table of tables) {
    const cfg = getTableConfig(table);
    await client.exec(
      `create table "${cfg.name}" (${cfg.columns
        .map((c) => {
          let def = '';
          if (c.default instanceof SQL) {
            const wire = dialect.sqlToQuery(c.default);
            if (!wire.params.length) def = ` default ${wire.sql}`;
          } else if (c.default !== undefined)
            def = ` default '${JSON.stringify(c.default).replaceAll("'", "''").replace(/^"|"$/g, '')}'`;
          return `"${c.name}" ${c.getSQLType()}${def}`;
        })
        .join(',')})`,
    );
  }
}, 30000);
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  for (const table of tables) await client.exec(`delete from "${getTableConfig(table).name}"`);
  await client.query(
    `insert into sales_orders(id,org_id,status,owner_id) values($1,$2,'draft',$3)`,
    [id, org, actorId],
  );
  await client.query(
    `insert into support_issues(id,org_id,subject,status,owner_id) values($1,$2,'Original','open',$3)`,
    [id, org, actorId],
  );
});
async function def(docType: string, transitions: unknown[]) {
  await client.query(
    `insert into workflow_defs(org_id,doc_type,name,enabled,states,transitions) values($1,$2,'Flow',true,'[]',$3::jsonb)`,
    [org, docType, JSON.stringify(transitions)],
  );
}
async function status(table: string) {
  return (await client.query<{ status: string }>(`select status from ${table} where id=$1`, [id]))
    .rows[0].status;
}
async function audits() {
  return (await client.query('select * from doc_audit_log')).rows;
}
describe('direct status PATCH validates the current locked state inside the mutation transaction', () => {
  it('sales A→B succeeds; an A→C intent arriving after B cannot mutate or audit', async () => {
    await def('sales_order', [
      { action: 'Confirm', from: 'draft', to: 'confirmed' },
      { action: 'Cancel draft', from: 'draft', to: 'cancelled' },
    ]);
    expect(
      (await setOrderStatus(ctx, id, 'confirmed', actor, undefined, workflowActor))?.status,
    ).toBe('confirmed');
    await expect(
      setOrderStatus(ctx, id, 'cancelled', actor, undefined, workflowActor),
    ).rejects.toMatchObject({ status: 409 });
    expect(await status('sales_orders')).toBe('confirmed');
    expect(await audits()).toHaveLength(1);
    expect((await audits())[0]).toMatchObject({ actor_id: actorId, ref_id: id });
  });
  it('support rechecks A→C before description, SLA timers, events or audit effects after A→B', async () => {
    await def('support_issue', [
      { action: 'Reply', from: 'open', to: 'replied' },
      { action: 'Resolve open', from: 'open', to: 'resolved' },
    ]);
    expect(
      (await updateIssue(ctx, id, { status: 'replied' }, actor, undefined, workflowActor))?.status,
    ).toBe('replied');
    await expect(
      updateIssue(
        ctx,
        id,
        { status: 'resolved', description: 'Must not persist' },
        actor,
        undefined,
        workflowActor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await status('support_issues')).toBe('replied');
    expect(await audits()).toHaveLength(1);
    const row = (
      await client.query('select description,resolved_at from support_issues where id=$1', [id])
    ).rows[0];
    expect(row).toEqual({ description: null, resolved_at: null });
  });
  it('selected admin role cannot reuse platform admin transition bypass or self-approval', async () => {
    await def('sales_order', [
      { action: 'Restricted', from: 'draft', to: 'confirmed', role: 'admin' },
      { action: 'Self blocked', from: 'draft', to: 'cancelled', allowSelfApprove: false },
    ]);
    const rules = [
      {
        role_key: 'selected',
        module: 'sales',
        can_view: true,
        can_create: true,
        can_edit: true,
        can_delete: false,
        can_export: false,
        can_manage: false,
        if_owner: true,
      },
    ];
    const scope = {
      orgId: org,
      profileId: actorId,
      roleKey: 'selected',
      generation: '30000000-0000-4000-8000-000000000001',
      rank: 40,
      invalid: false,
      capabilities: buildCapabilities(['selected'], rules),
    };
    await runWithEffectiveAuthority(scope, async () => {
      for (const next of ['confirmed', 'cancelled'] as const)
        await expect(
          setOrderStatus(ctx, id, next, actor, undefined, { ...actor, role: 'admin' }),
        ).rejects.toMatchObject({ status: 409 });
    });
    await runWithEffectiveAuthority(scope, async () => {
      await expect(
        setOrderStatus(ctx, id, 'confirmed', actor, undefined, {
          id: null,
          name: null,
          role: 'admin',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
    expect(await status('sales_orders')).toBe('draft');
    expect(await audits()).toHaveLength(0);
  });
  it('no-workflow direct edits and internal callers retain their existing contract', async () => {
    expect(
      (await setOrderStatus(ctx, id, 'confirmed', actor, undefined, workflowActor))?.status,
    ).toBe('confirmed');
    await def('sales_order', [{ action: 'Unused', from: 'draft', to: 'confirmed' }]);
    expect((await setOrderStatus(ctx, id, 'cancelled', actor))?.status).toBe('cancelled');
  });
  it('a no-role actor (the assistant) takes only open transitions', async () => {
    const assistant = { ...actor, role: null };
    await def('sales_order', [
      { action: 'Confirm', from: 'draft', to: 'confirmed' },
      { action: 'Cancel', from: 'draft', to: 'cancelled', role: 'manager' },
    ]);
    await expect(
      setOrderStatus(ctx, id, 'invoiced', actor, undefined, assistant),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      setOrderStatus(ctx, id, 'cancelled', actor, undefined, assistant),
    ).rejects.toMatchObject({ status: 409 });
    expect(await status('sales_orders')).toBe('draft');
    expect((await setOrderStatus(ctx, id, 'confirmed', actor, undefined, assistant))?.status).toBe(
      'confirmed',
    );
  });
});
