import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { afterAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { CrmTagBulkStorageError, mutateCrmContactTagsBulk } from './crm-contact-tags-bulk.service';

const databaseUrl = testDatabaseUrl();
const mutationQueries: { sql: string; bindCount: number }[] = [];
function recordMutationQuery(_connection: number, query: string, parameters: unknown[]) {
  if (query.includes('jsonb_to_recordset')) {
    mutationQueries.push({ sql: query, bindCount: parameters.length });
  }
}
const admin = databaseUrl ? postgres(databaseUrl, { max: 2, prepare: false }) : null;
const appClientA = databaseUrl
  ? postgres(databaseUrl, { max: 1, prepare: false, debug: recordMutationQuery })
  : null;
const appClientB = databaseUrl
  ? postgres(databaseUrl, { max: 1, prepare: false, debug: recordMutationQuery })
  : null;
const appDbA = appClientA ? drizzle(appClientA, { schema: pgSchema }) : null;
const appDbB = appClientB ? drizzle(appClientB, { schema: pgSchema }) : null;

describe.runIf(Boolean(databaseUrl))('CRM contact tag bulk native SQL', () => {
  afterAll(async () => {
    await Promise.all([admin?.end(), appClientA?.end(), appClientB?.end()]);
  });

  it('classifies mixed authority cases, preserves no-ops, and isolates concurrent organizations', async () => {
    mutationQueries.length = 0;
    const orgA = `crm-bulk-a-${randomUUID()}`;
    const orgB = `crm-bulk-b-${randomUUID()}`;
    const contactA = randomUUID();
    const deletedA = randomUUID();
    const contactB = randomUUID();
    const manualA = randomUUID();
    const existingA = randomUUID();
    const absentA = randomUUID();
    const wrongScopeA = randomUUID();
    const ruleA = randomUUID();
    const manualB = randomUUID();
    const actorA = randomUUID();
    const ctxA = { tenantId: orgA, db: appDbA! };
    const ctxB = { tenantId: orgB, db: appDbB! };

    try {
      await admin!`insert into crm_contacts (id,org_id,source,deleted_at) values
        (${contactA},${orgA},'manual',null),
        (${deletedA},${orgA},'manual',now()),
        (${contactB},${orgB},'manual',null)`;
      await admin!`insert into crm_tags (id,org_id,name,kind,scope,position) values
        (${manualA},${orgA},'Manual A','manual','crm',0),
        (${existingA},${orgA},'Existing A','manual','crm',1),
        (${absentA},${orgA},'Absent A','manual','crm',2),
        (${wrongScopeA},${orgA},'Stock A','manual','stock',3),
        (${ruleA},${orgA},'Rule A','auto','crm',4),
        (${manualB},${orgB},'Manual B','manual','crm',0)`;
      await admin!`insert into crm_contact_tags (org_id,contact_id,tag_id)
        values (${orgA},${contactA},${existingA})`;

      const operations = [
        { targetId: contactA, tagId: manualA, action: 'add' as const },
        { targetId: contactA, tagId: existingA, action: 'add' as const },
        { targetId: contactA, tagId: absentA, action: 'remove' as const },
        { targetId: deletedA, tagId: manualA, action: 'add' as const },
        { targetId: contactB, tagId: manualA, action: 'add' as const },
        { targetId: contactA, tagId: manualB, action: 'add' as const },
        { targetId: contactA, tagId: wrongScopeA, action: 'add' as const },
        { targetId: contactA, tagId: ruleA, action: 'add' as const },
        { targetId: randomUUID(), tagId: manualA, action: 'add' as const },
      ];
      const result = await mutateCrmContactTagsBulk(ctxA, operations, actorA);

      expect(mutationQueries).toHaveLength(1);
      expect(mutationQueries.at(-1)?.bindCount).toBe(2);
      expect(result.changedRows).toBe(1);
      expect(result.results.map((entry) => entry.disposition)).toEqual([
        'completed',
        'completed',
        'completed',
        'pending',
        'pending',
        'pending',
        'pending',
        'pending',
        'pending',
      ]);
      const [inserted] = await admin!<{ applied_by: string | null }[]>`
        select applied_by::text from crm_contact_tags
        where org_id=${orgA} and contact_id=${contactA} and tag_id=${manualA}`;
      expect(inserted?.applied_by).toBe(actorA);

      const [linksA, linksB] = await Promise.all([
        mutateCrmContactTagsBulk(
          ctxA,
          [{ targetId: contactA, tagId: manualA, action: 'remove' }],
          null,
        ),
        mutateCrmContactTagsBulk(
          ctxB,
          [{ targetId: contactB, tagId: manualB, action: 'add' }],
          null,
        ),
      ]);
      expect([linksA.changedRows, linksB.changedRows]).toEqual([1, 1]);
      const rows = await admin!<
        {
          org_id: string;
          contact_id: string;
          tag_id: string;
          applied_by: string | null;
        }[]
      >`
        select org_id,contact_id::text,tag_id::text,applied_by::text from crm_contact_tags
        where org_id in (${orgA},${orgB}) order by org_id,tag_id`;
      expect(rows).toEqual([
        { org_id: orgA, contact_id: contactA, tag_id: existingA, applied_by: null },
        { org_id: orgB, contact_id: contactB, tag_id: manualB, applied_by: null },
      ]);
    } finally {
      await admin!`delete from crm_contact_tags where org_id in (${orgA},${orgB})`;
      await admin!`delete from crm_tags where org_id in (${orgA},${orgB})`;
      await admin!`delete from crm_contacts where org_id in (${orgA},${orgB})`;
    }
  });

  it('mutates and repeats 2,000 valid operations with one statement and two binds per pass', async () => {
    mutationQueries.length = 0;
    const org = `crm-bulk-max-${randomUUID()}`;
    const tagId = randomUUID();
    const contactIds = Array.from({ length: 2_000 }, () => randomUUID());
    const ctx = { tenantId: org, db: appDbA! };
    try {
      await admin!`insert into crm_tags (id,org_id,name,kind,scope,position)
        values (${tagId},${org},'Maximum valid tag','manual','crm',0)`;
      await admin!`insert into crm_contacts (id,org_id,source)
        select id,${org},'manual' from unnest(${contactIds}::uuid[]) as id`;
      const adds = contactIds.map((targetId) => ({ targetId, tagId, action: 'add' as const }));
      const removes = contactIds.map((targetId) => ({
        targetId,
        tagId,
        action: 'remove' as const,
      }));

      const added = await mutateCrmContactTagsBulk(ctx, adds, null);
      expect(added.results).toHaveLength(2_000);
      expect(added.results.every((entry) => entry.disposition === 'completed')).toBe(true);
      expect(added.changedRows).toBe(2_000);
      const addedAgain = await mutateCrmContactTagsBulk(ctx, adds, null);
      expect(addedAgain.results.every((entry) => entry.disposition === 'completed')).toBe(true);
      expect(addedAgain.changedRows).toBe(0);
      const removed = await mutateCrmContactTagsBulk(ctx, removes, null);
      expect(removed.results.every((entry) => entry.disposition === 'completed')).toBe(true);
      expect(removed.changedRows).toBe(2_000);
      const removedAgain = await mutateCrmContactTagsBulk(ctx, removes, null);
      expect(removedAgain.results.every((entry) => entry.disposition === 'completed')).toBe(true);
      expect(removedAgain.changedRows).toBe(0);
      const [{ count }] = await admin!<{ count: number }[]>`
        select count(*)::integer as count from crm_contact_tags where org_id=${org}`;
      expect(count).toBe(0);
      expect(mutationQueries).toHaveLength(4);
      expect(mutationQueries.every((query) => query.bindCount === 2)).toBe(true);
    } finally {
      await admin!`delete from crm_contact_tags where org_id=${org}`;
      await admin!`delete from crm_tags where org_id=${org}`;
      await admin!`delete from crm_contacts where org_id=${org}`;
    }
  });

  it('cannot leave orphan links when contacts and tags are deleted concurrently', async () => {
    const org = `crm-bulk-delete-${randomUUID()}`;
    const contactDeleted = randomUUID();
    const contactKept = randomUUID();
    const tagKept = randomUUID();
    const tagDeleted = randomUUID();
    const ctx = { tenantId: org, db: appDbA! };
    try {
      await admin!`insert into crm_contacts (id,org_id,source) values
        (${contactDeleted},${org},'manual'),(${contactKept},${org},'manual')`;
      await admin!`insert into crm_tags (id,org_id,name,kind,scope,position) values
        (${tagKept},${org},'Kept','manual','crm',0),
        (${tagDeleted},${org},'Deleted','manual','crm',1)`;

      const mutation = mutateCrmContactTagsBulk(
        ctx,
        [
          { targetId: contactDeleted, tagId: tagKept, action: 'add' },
          { targetId: contactKept, tagId: tagDeleted, action: 'add' },
        ],
        null,
      );
      const deletion = admin!.begin(async (tx) => {
        await tx`delete from crm_contacts where org_id=${org} and id=${contactDeleted}`;
        await tx`delete from crm_tags where org_id=${org} and id=${tagDeleted}`;
      });
      const [mutationOutcome, deletionOutcome] = await Promise.allSettled([mutation, deletion]);
      expect(deletionOutcome.status).toBe('fulfilled');
      // Either commit order is valid: the mutation completes/no-ops first, or a
      // concurrent FK change aborts it. Cascades and the transaction forbid orphans.
      if (mutationOutcome.status === 'fulfilled') {
        expect(mutationOutcome.value.results).toHaveLength(2);
        expect(mutationOutcome.value.results.map((entry) => entry.operation)).toEqual([
          { targetId: contactDeleted, tagId: tagKept, action: 'add' },
          { targetId: contactKept, tagId: tagDeleted, action: 'add' },
        ]);
        expect(
          mutationOutcome.value.results.every(
            (entry) => entry.disposition === 'completed' || entry.errorCode === 'invalid_operation',
          ),
        ).toBe(true);
      } else {
        const reason = mutationOutcome.reason as { sqlState?: string };
        expect(reason.sqlState).toMatch(/^(23503|40P01|40001)$/);
      }
      const [{ count }] = await admin!<{ count: number }[]>`
        select count(*)::integer as count from crm_contact_tags
        where org_id=${org} and (contact_id=${contactDeleted} or tag_id=${tagDeleted})`;
      expect(count).toBe(0);
    } finally {
      await admin!`delete from crm_contact_tags where org_id=${org}`;
      await admin!`delete from crm_tags where org_id=${org}`;
      await admin!`delete from crm_contacts where org_id=${org}`;
    }
  });

  it('rolls back every mutation when the native statement fails', async () => {
    const org = `crm-bulk-rollback-${randomUUID()}`;
    const contactId = randomUUID();
    const existingTag = randomUUID();
    const newTag = randomUUID();
    const ctx = { tenantId: org, db: appDbA! };
    try {
      await admin!`insert into crm_contacts (id,org_id,source)
        values (${contactId},${org},'manual')`;
      await admin!`insert into crm_tags (id,org_id,name,kind,scope,position) values
        (${existingTag},${org},'Existing','manual','crm',0),
        (${newTag},${org},'New','manual','crm',1)`;
      await admin!`insert into crm_contact_tags (org_id,contact_id,tag_id)
        values (${org},${contactId},${existingTag})`;

      let failure: unknown;
      try {
        await mutateCrmContactTagsBulk(
          ctx,
          [
            { targetId: contactId, tagId: existingTag, action: 'remove' },
            { targetId: contactId, tagId: newTag, action: 'add' },
          ],
          'not-a-uuid',
        );
      } catch (cause) {
        failure = cause;
      }
      expect(failure).toBeInstanceOf(CrmTagBulkStorageError);
      expect((failure as CrmTagBulkStorageError).sqlState).toBe('22P02');
      const rows = await admin!<{ tag_id: string }[]>`
        select tag_id::text from crm_contact_tags
        where org_id=${org} and contact_id=${contactId} order by tag_id`;
      expect(rows).toEqual([{ tag_id: existingTag }]);
    } finally {
      await admin!`delete from crm_contact_tags where org_id=${org}`;
      await admin!`delete from crm_tags where org_id=${org}`;
      await admin!`delete from crm_contacts where org_id=${org}`;
    }
  });
});
