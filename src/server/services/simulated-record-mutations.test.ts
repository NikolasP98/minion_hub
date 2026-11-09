import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  runWithEffectiveAuthority,
  runWithRequestCapabilities,
} from '$server/auth/effective-authority';
import { buildCapabilities } from './rbac.service';
import {
  crmContacts,
  crmContactIdentities,
  crmActivities,
  crmTags,
  crmContactTags,
  crmContactGuardians,
} from '$server/db/pg-crm-schema';
import { schedBookings, schedEventTypes } from '$server/db/pg-scheduling-schema';
import { salesOrders } from '$server/db/pg-sales-schema';
import { supportIssues, supportSettings } from '$server/db/pg-support-schema';
import { parties } from '$server/db/pg-party-schema';
import { docAuditLog, docComments } from '$server/db/pg-activity-schema';
import { membershipPlans, memberships, membershipCycles } from '$server/db/pg-membership-schema';
import { createOrderFromBooking, setOrderStatus } from './sales.service';
import { createIssue, updateIssue } from './support.service';
import {
  createContact,
  updateContact,
  softDeleteContact,
  softDeleteContacts,
  hardDeleteContact,
  addNote,
  applyTag,
  removeTag,
  applyTagBulk,
  setContactCustomField,
  setFunnelStage,
  deleteTag,
} from './crm-contacts.service';
import { mutateCrmContactTagsBulk } from './crm-contact-tags-bulk.service';
import { addGuardian, removeGuardian } from './crm-guardians.service';
import { mergeContacts } from './crm-cleanup.service';
import { setPartyPhone, ensureParty, ensureContactFacetForParty } from './party.service';
import { ensureCrmContact } from './crm-contact-ensure';
import { addComment } from './activity.service';
import { reassign } from './assignment.service';
import { processMembershipCycles } from './membership.service';
import { putCustomPropertyValueInTx } from './custom-properties.service';
import { relationshipInferenceTick } from './crm-relationship-inference.service';

vi.mock('@minion-stack/cache', () => ({
  cached: (_k: unknown, _o: unknown, fn: () => unknown) => fn(),
  keys: { hub: () => 'k' },
  invalidateTags: async () => {},
  tags: { tenantDomain: () => ['crm'] },
}));
vi.mock('$server/events/emit', () => ({ emitHubEvent: vi.fn(async () => {}) }));
let openTx: CoreTx | undefined;
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (scope: { db: ReturnType<typeof drizzle> }, fn: (tx: CoreTx) => unknown) => {
    if (openTx) return fn(openTx);
    return scope.db.transaction(async (tx) => {
      openTx = nativeShape(tx);
      try {
        return await fn(openTx);
      } finally {
        openTx = undefined;
      }
    });
  },
}));
const dialect = new PgDialect();
function nativeShape(
  tx: Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0],
): CoreTx {
  return new Proxy(tx, {
    get(target, key, receiver) {
      if (key === 'execute') return async (query: SQL) => (await target.execute(query)).rows;
      if (key === 'transaction')
        return (fn: (sp: CoreTx) => unknown) =>
          target.transaction(async (sp) => fn(nativeShape(sp)));
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as CoreTx;
}
const org = 'scope-org',
  actorId = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002';
const own = '20000000-0000-4000-8000-000000000001',
  foreign = '20000000-0000-4000-8000-000000000002',
  crossOrg = '20000000-0000-4000-8000-000000000003';
const ownParty = '30000000-0000-4000-8000-000000000001',
  foreignParty = '30000000-0000-4000-8000-000000000002',
  tag = '40000000-0000-4000-8000-000000000001';
const actor = { id: actorId, name: 'Actual actor' },
  ctxActor = { ...actor, isAdmin: true };
function scope(
  opts: {
    owner?: boolean;
    edit?: boolean;
    create?: boolean;
    module?: string;
    invalid?: boolean;
  } = {},
) {
  const rules = (opts.module ? [opts.module] : ['crm', 'sales', 'support']).map((module) => ({
    role_key: 'selected',
    module,
    can_view: true,
    can_create: opts.create ?? true,
    can_edit: opts.edit ?? true,
    can_delete: true,
    can_export: false,
    can_manage: false,
    if_owner: opts.owner ?? true,
  }));
  return {
    orgId: org,
    profileId: actorId,
    roleKey: 'selected',
    rank: 40,
    generation: '50000000-0000-4000-8000-000000000001',
    invalid: opts.invalid ?? false,
    capabilities: buildCapabilities(['selected'], rules),
  };
}
let client: PGlite, ctx: CoreCtx;
const tables: PgTable[] = [
  crmContacts,
  crmContactIdentities,
  crmActivities,
  crmTags,
  crmContactTags,
  crmContactGuardians,
  salesOrders,
  supportIssues,
  supportSettings,
  parties,
  docAuditLog,
  docComments,
  membershipPlans,
  memberships,
  membershipCycles,
  schedBookings,
  schedEventTypes,
];
beforeAll(async () => {
  client = new PGlite();
  ctx = { db: drizzle(client), tenantId: org, profileId: actorId } as unknown as CoreCtx;
  for (const table of tables) {
    const cfg = getTableConfig(table);
    const columns = cfg.columns.map((c) => {
      let def = '';
      if (c.default instanceof SQL) {
        const q = dialect.sqlToQuery(c.default);
        if (!q.params.length) def = ` default ${q.sql}`;
      } else if (c.default !== undefined)
        def = ` default '${JSON.stringify(c.default).replaceAll("'", "''").replace(/^"|"$/g, '')}'`;
      return `"${c.name}" ${c.getSQLType()}${def}${c.primary ? ' primary key' : ''}`;
    });
    await client.exec(`create table "${cfg.name}" (${columns.join(',')})`);
  }
  await client.exec(
    'create unique index tags_uniq on crm_contact_tags(contact_id,tag_id); create unique index identities_uniq on crm_contact_identities(org_id,channel,external_id); create unique index cycles_uniq on membership_cycles(membership_id,cycle_no); create table naming_series_counters(org_id text,prefix text,n int,updated_at timestamptz default now(),primary key(org_id,prefix));',
  );
}, 30000);
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  for (const table of tables) await client.exec(`delete from "${getTableConfig(table).name}"`);
  await client.exec(
    `delete from naming_series_counters;select set_config('app.current_org_id','${org}',false);`,
  );
  for (const table of ['crm_contacts', 'sales_orders', 'support_issues']) {
    const extra =
      table === 'support_issues'
        ? ',subject,status'
        : table === 'sales_orders'
          ? ',status'
          : ',display_name,source,party_id';
    const vals =
      table === 'support_issues'
        ? ",'Original','open'"
        : table === 'sales_orders'
          ? ",'draft'"
          : ",'Original','manual',$6";
    for (const [id, tenant, owner, party] of [
      [own, org, actorId, ownParty],
      [foreign, org, other, foreignParty],
      [crossOrg, 'foreign-org', actorId, null],
    ])
      await client.query(
        `insert into ${table}(id,org_id,owner_id${extra}) values($1,$2,$3${vals.replace('$6', '$4')})`,
        table === 'crm_contacts' ? [id, tenant, owner, party] : [id, tenant, owner],
      );
  }
  await client.query(
    `insert into parties(id,org_id,type,name,phone9) values($1,$3,'person','Own','900000001'),($2,$3,'person','Foreign','900000002')`,
    [ownParty, foreignParty, org],
  );
  await client.query(
    `insert into crm_contact_identities(org_id,contact_id,channel,external_id) values($1,$2,'email','foreign@example.invalid')`,
    [org, foreign],
  );
  await client.query(
    `insert into crm_tags(id,org_id,name,kind,scope) values($1,$2,'Tag','manual','crm')`,
    [tag, org],
  );
});
interface FixtureRowMap {
  naming_series_counters: { n: number };
  doc_audit_log: { actor_id: string | null; ref_id: string };
  crm_contacts: { id: string; display_name: string | null };
  support_issues: { subject: string };
  crm_activities: { contact_id: string };
  crm_contact_tags: { contact_id: string };
  doc_comments: { ref_id: string };
  memberships: { cycle_no: number };
  membership_cycles: Record<string, unknown>;
}
async function rows<T extends keyof FixtureRowMap>(table: T) {
  return (await client.query<FixtureRowMap[T]>(`select * from ${table}`)).rows;
}

async function inScope<T>(fn: () => T, options: Parameters<typeof scope>[0] = {}) {
  return runWithEffectiveAuthority(scope(options), fn);
}

describe('simulated domain mutations execute under selected action and own-record scope', () => {
  it('booking to sales order denies before counters, creates under actual owner, and refuses existing foreign order', async () => {
    const booking = '80000000-0000-4000-8000-000000000001',
      event = '90000000-0000-4000-8000-000000000001';
    await client.query(`insert into sched_event_types(id,org_id,title) values($1,$2,'Visit')`, [
      event,
      org,
    ]);
    await client.query(
      `insert into sched_bookings(id,org_id,event_type_id,attendee_name) values($1,$2,$3,'Customer')`,
      [booking, org, event],
    );
    await expect(
      inScope(() => createOrderFromBooking(ctx, booking), { module: 'crm' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await rows('naming_series_counters')).toHaveLength(0);
    const order = await inScope(() => createOrderFromBooking(ctx, booking));
    expect(order.ownerId).toBe(actorId);
    expect(order.description).toBe('Visit');
    await client.query('update sales_orders set owner_id=$1 where id=$2', [other, order.id]);
    await expect(inScope(() => createOrderFromBooking(ctx, booking))).rejects.toMatchObject({
      status: 404,
    });
    expect((await rows('naming_series_counters'))[0].n).toBe(1);
  });
  it('custom-property writes lock the CRM record before property metadata or value effects', async () => {
    await expect(
      inScope(() =>
        ctx.db.transaction((tx) =>
          putCustomPropertyValueInTx(
            nativeShape(tx as never),
            ctx,
            'crm.customers',
            tag,
            foreign,
            'No',
            0,
          ),
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
    // No property tables exist in this fixture: a late owner check would hit SQL first.
  });
  it('relationship inference rejects simulation before contact claim metadata or model work', async () => {
    await expect(
      inScope(() =>
        relationshipInferenceTick(ctx, { remainingBudget: 10, deadline: Date.now() + 10000 }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await client.query<{ custom_fields: Record<string, unknown> }>(
          'select custom_fields from crm_contacts where id=$1',
          [foreign],
        )
      ).rows[0].custom_fields,
    ).toEqual({});
  });
  it('a rejected audit rolls back an owned real sales mutation', async () => {
    await client.exec(
      "create function reject_domain_audit() returns trigger language plpgsql as $$begin raise exception 'test audit rejected';end$$;create trigger reject_domain_audit before insert on doc_audit_log for each row execute function reject_domain_audit();",
    );
    try {
      await expect(inScope(() => setOrderStatus(ctx, own, 'confirmed', actor))).rejects.toThrow();
      expect(
        (
          await client.query<{ status: string }>('select status from sales_orders where id=$1', [
            own,
          ])
        ).rows[0].status,
      ).toBe('draft');
    } finally {
      await client.exec(
        'drop trigger reject_domain_audit on doc_audit_log;drop function reject_domain_audit();',
      );
    }
  });

  it('sales status and support non-workflow PATCH reject foreign, unowned and cross-org rows before audit/effects', async () => {
    await client.query('update sales_orders set owner_id=null where id=$1', [crossOrg]);
    await inScope(async () => {
      for (const id of [foreign, crossOrg]) {
        expect(await setOrderStatus(ctx, id, 'confirmed', actor)).toBeNull();
        expect(
          await updateIssue(ctx, id, { description: 'Forbidden', priority: 'urgent' }, actor),
        ).toBeNull();
      }
      expect((await setOrderStatus(ctx, own, 'confirmed', actor))?.status).toBe('confirmed');
      expect(
        (await updateIssue(ctx, own, { description: 'Real update' }, actor))?.description,
      ).toBe('Real update');
    });
    expect((await rows('doc_audit_log')).map((r) => [r.actor_id, r.ref_id])).toEqual([
      [actorId, own],
    ]);
    expect(
      (
        await client.query<{ description: string | null }>(
          'select description from support_issues where id=$1',
          [foreign],
        )
      ).rows[0].description,
    ).toBeNull();
  });
  it('unowned same-org records do not become unrestricted and missing actor context fails closed', async () => {
    await client.query('update sales_orders set owner_id=null where id=$1', [foreign]);
    await client.query('update support_issues set owner_id=null where id=$1', [foreign]);
    await inScope(async () => {
      expect(await setOrderStatus(ctx, foreign, 'confirmed', actor)).toBeNull();
      expect(await updateIssue(ctx, foreign, { description: 'No' })).toBeNull();
      await expect(
        createContact({ ...ctx, profileId: undefined }, { displayName: 'No actor' }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
  it('authenticated simulation cannot swallow CRM storage failure and proceed to dependent effects', async () => {
    const failure = new Error('CRM storage failed');
    const tx = {
      execute: async () => {
        throw failure;
      },
    } as unknown as CoreTx;
    await expect(
      inScope(() => ensureCrmContact(tx, org, { email: 'new@example.invalid', source: 'booking' })),
    ).rejects.toBe(failure);
    expect(
      await ensureCrmContact(tx, 'independent-org', {
        email: 'new@example.invalid',
        source: 'booking',
      }),
    ).toBeNull();
  });
  it('stale preimage paths never return a foreign current row', async () => {
    await inScope(async () => {
      expect(await setOrderStatus(ctx, foreign, 'confirmed', actor, new Date(0))).toBeNull();
      expect(await updateIssue(ctx, foreign, { subject: 'x' }, actor, new Date(0))).toBeNull();
      expect(await updateContact(ctx, foreign, { displayName: 'x' }, new Date(0))).toBeNull();
    });
  });
  it.each(['crm', 'sales', 'support'])(
    'missing %s edit is denied even when ownerScoped is false',
    async (module) => {
      const mutation: () => Promise<unknown> =
        module === 'crm'
          ? () => updateContact(ctx, own, { displayName: 'No' })
          : module === 'sales'
            ? () => setOrderStatus(ctx, own, 'confirmed', actor)
            : () => updateIssue(ctx, own, { description: 'No' });
      await expect(inScope(mutation, { owner: false, edit: false })).rejects.toMatchObject({
        status: 403,
      });
      await expect(inScope(mutation, { owner: false, invalid: true })).rejects.toMatchObject({
        status: 403,
      });
    },
  );
  it('unscoped selected role and ordinary caller retain real edits to other owners', async () => {
    expect(
      (
        await inScope(() => updateContact(ctx, foreign, { displayName: 'Selected edit' }), {
          owner: false,
        })
      )?.displayName,
    ).toBe('Selected edit');
    expect((await updateContact(ctx, foreign, { displayName: 'Ordinary edit' }))?.displayName).toBe(
      'Ordinary edit',
    );
  });
  it('fresh actual own-record roles use the same mutation ceiling as simulated roles', async () => {
    const admitted = scope();
    await runWithRequestCapabilities(admitted, async () => {
      expect(await updateContact(ctx, foreign, { displayName: 'Forbidden' })).toBeNull();
      expect((await updateContact(ctx, own, { displayName: 'Actual own edit' }))?.displayName).toBe(
        'Actual own edit',
      );
      await expect(addNote(ctx, foreign, 'Forbidden', actorId)).rejects.toMatchObject({
        status: 404,
      });
      await expect(updateContact(ctx, own, { ownerId: other })).rejects.toMatchObject({
        status: 403,
      });
    });
    expect((await rows('crm_contacts')).find((row) => row.id === foreign)?.display_name).toBe(
      'Original',
    );
  });
  it('ordinary platform admins keep their bypass but a selected role still governs their writes', async () => {
    await runWithRequestCapabilities({ ...scope(), platformAdmin: true }, async () => {
      expect((await updateContact(ctx, foreign, { displayName: 'Admin edit' }))?.displayName).toBe(
        'Admin edit',
      );
      expect(
        await inScope(() => updateContact(ctx, foreign, { displayName: 'Forbidden' })),
      ).toBeNull();
    });
  });
  it('owned creates are assigned to actual actor; explicit transfer/unassignment fails before insertion', async () => {
    await inScope(async () => {
      expect((await createContact(ctx, { displayName: 'New' })).ownerId).toBe(actorId);
      expect((await createIssue(ctx, { subject: 'New' })).ownerId).toBe(actorId);
      for (const ownerId of [other, null]) {
        await expect(updateContact(ctx, own, { ownerId })).rejects.toMatchObject({ status: 403 });
        await expect(updateIssue(ctx, own, { ownerId })).rejects.toMatchObject({ status: 403 });
      }
      await expect(
        createIssue(ctx, { subject: 'Forbidden', ownerId: other }),
      ).rejects.toMatchObject({ status: 403 });
    });
    expect((await rows('support_issues')).filter((r) => r.subject === 'Forbidden')).toHaveLength(0);
  });
  it('CRM updates/delete paths and low-level custom-field setter protect actual owner', async () => {
    await inScope(async () => {
      expect(
        await updateContact(ctx, foreign, {
          displayName: 'No',
          phone: '999999999',
          dob: '1990-01-01',
        }),
      ).toBeNull();
      await expect(softDeleteContact(ctx, foreign)).rejects.toMatchObject({ status: 404 });
      await expect(hardDeleteContact(ctx, foreign)).rejects.toMatchObject({ status: 404 });
      await ctx.db.transaction(async (raw) => {
        expect(
          await setContactCustomField(nativeShape(raw as never), org, foreign, 'test', 'No'),
        ).toBe(false);
        expect(
          await setContactCustomField(nativeShape(raw as never), org, own, 'test', 'Real'),
        ).toBe(true);
      });
      expect(await softDeleteContacts(ctx, [own, foreign, crossOrg])).toBe(1);
    });
    expect(
      (
        await client.query<{ deleted_at: string | null; custom_fields: Record<string, unknown> }>(
          'select deleted_at,custom_fields from crm_contacts where id=$1',
          [foreign],
        )
      ).rows[0],
    ).toMatchObject({ deleted_at: null, custom_fields: {} });
  });
  it('child notes, tags, funnel, guardian links, comments and merge fail before dependent writes', async () => {
    await inScope(async () => {
      for (const run of [
        () => addNote(ctx, foreign, 'No', actorId),
        () => applyTag(ctx, foreign, tag, actorId),
        () => removeTag(ctx, foreign, tag),
        () => applyTagBulk(ctx, tag, [own, foreign]),
        () => addGuardian(ctx, own, foreign),
        () => removeGuardian(ctx, own, foreign),
        () => mergeContacts(ctx, own, [foreign]),
        () => addComment(ctx, 'crm_contact', foreign, 'No', actor),
      ])
        await expect(run()).rejects.toMatchObject({ status: 404 });
      expect((await setFunnelStage(ctx, foreign, 'lead', { by: 'user' })).applied).toBe(false);
      await expect(deleteTag(ctx, tag)).rejects.toMatchObject({ status: 403 });
      await addNote(ctx, own, 'Real', actorId);
      await applyTag(ctx, own, tag, actorId);
      await addComment(ctx, 'crm_contact', own, 'Real', actor);
    });
    expect((await rows('crm_activities')).map((r) => r.contact_id)).toEqual([own]);
    expect((await rows('crm_contact_tags')).map((r) => r.contact_id)).toEqual([own]);
    expect((await rows('doc_comments')).map((r) => r.ref_id)).toEqual([own]);
  });
  it('shared party DOB rejects a foreign linked facet and rolls back contact changes', async () => {
    await client.query('update crm_contacts set party_id=$1 where id=$2', [ownParty, foreign]);
    await expect(
      inScope(() => updateContact(ctx, own, { displayName: 'Must roll back', dob: '1990-01-01' })),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await client.query<{ display_name: string | null }>(
          'select display_name from crm_contacts where id=$1',
          [own],
        )
      ).rows[0].display_name,
    ).toBe('Original');
    expect(
      (
        await client.query<{ dob: string | null }>('select dob from parties where id=$1', [
          ownParty,
        ])
      ).rows[0].dob,
    ).toBeNull();
  });
  it('canonical bulk tag operation reports foreign target pending while committing owned target only', async () => {
    const result = await inScope(() =>
      mutateCrmContactTagsBulk(
        ctx,
        [
          { targetId: own, tagId: tag, action: 'add' },
          { targetId: foreign, tagId: tag, action: 'add' },
        ],
        actorId,
      ),
    );
    expect(result.changedRows).toBe(1);
    expect(result.results.map((r) => r.disposition)).toEqual(['completed', 'pending']);
    expect((await rows('crm_contact_tags')).map((r) => r.contact_id)).toEqual([own]);
  });
  it('party edit and reassignment cannot mutate another owner through shared identity', async () => {
    await inScope(async () => {
      await expect(setPartyPhone(ctx, foreignParty, '988888888')).rejects.toMatchObject({
        status: 404,
      });
      expect((await setPartyPhone(ctx, ownParty, '977777777'))?.phone9).toBe('977777777');
      await expect(reassign(ctx, 'crm_contact', own, other, ctxActor)).rejects.toMatchObject({
        status: 403,
      });
      await expect(reassign(ctx, 'crm_contact', foreign, actorId, ctxActor)).rejects.toMatchObject({
        status: 404,
      });
      expect(await reassign(ctx, 'crm_contact', own, actorId, ctxActor)).toBe('ok');
    });
    expect(
      (
        await client.query<{ phone9: string | null }>('select phone9 from parties where id=$1', [
          foreignParty,
        ])
      ).rows[0].phone9,
    ).toBe('900000002');
  });
  it('registration factories refuse existing foreign facets without swallowing denial, and assign new owned facet', async () => {
    await inScope(async () => {
      await expect(
        ctx.db.transaction((tx) =>
          ensureCrmContact(nativeShape(tx as never), org, {
            email: 'foreign@example.invalid',
            source: 'booking',
          }),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        ensureContactFacetForParty(ctx, foreignParty, { displayName: null, customFields: {} }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        ensureParty(ctx, { name: 'Backfill', phone: '900000002' }),
      ).rejects.toMatchObject({ status: 404 });
      const created = await ctx.db.transaction((tx) =>
        ensureCrmContact(nativeShape(tx as never), org, {
          email: 'new@example.invalid',
          source: 'booking',
        }),
      );
      expect(
        (
          await client.query<{ owner_id: string | null }>(
            'select owner_id from crm_contacts where id=$1',
            [created?.id],
          )
        ).rows[0].owner_id,
      ).toBe(actorId);
    });
  });
  it.each(['pos', 'scheduling'])(
    'preserves %s customer registration without CRM permission',
    async (module) => {
      const created = await inScope(
        () =>
          ctx.db.transaction((tx) =>
            ensureCrmContact(nativeShape(tx as never), org, {
              email: `${module}@example.invalid`,
              source: 'booking',
            }),
          ),
        { module, owner: false },
      );
      expect(created?.created).toBe(true);
    },
  );
  it('denies cross-domain billing before cycle claim, counter or watermark effects', async () => {
    const plan = '60000000-0000-4000-8000-000000000001',
      membership = '70000000-0000-4000-8000-000000000001';
    await client.query(
      `insert into membership_plans(id,org_id,name,enabled,interval_unit,interval_count,price) values($1,$2,'Plan',true,'month',1,10)`,
      [plan, org],
    );
    await client.query(
      `insert into memberships(id,org_id,plan_id,status,cycle_no,next_cycle_date) values($1,$2,$3,'active',0,'2026-01-01')`,
      [membership, org, plan],
    );
    await expect(
      inScope(() => processMembershipCycles(ctx, new Date('2026-01-02')), { module: 'crm' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await rows('membership_cycles')).toHaveLength(0);
    expect(await rows('naming_series_counters')).toHaveLength(0);
    expect((await rows('memberships'))[0].cycle_no).toBe(0);
    await expect(
      inScope(() => processMembershipCycles(ctx, new Date('2026-01-02'))),
    ).rejects.toMatchObject({ status: 403 });
    expect(await rows('membership_cycles')).toHaveLength(0);
    expect(
      (await inScope(() => processMembershipCycles(ctx, new Date('2026-01-02')), { owner: false }))
        .spawned,
    ).toBe(1);
  });
});
