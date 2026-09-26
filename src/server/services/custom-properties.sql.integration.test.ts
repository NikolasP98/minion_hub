import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { withOrgCore } from '$server/db/with-org-core';
import { appTableProperties } from '$server/db/pg-schema/custom-properties';
import {
  createCustomProperty,
  listCustomProperties,
  putCustomPropertyValue,
  readCustomPropertyValues,
  updateCustomProperty,
} from './custom-properties.service';

const databaseUrl = testDatabaseUrl();
const admin = databaseUrl ? postgres(databaseUrl, { max: 2, prepare: false }) : null;
const clientA = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const clientB = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const dbA = clientA ? drizzle(clientA, { schema: pgSchema }) : null;
const dbB = clientB ? drizzle(clientB, { schema: pgSchema }) : null;

describe.runIf(Boolean(databaseUrl))('custom properties PostgreSQL invariants', () => {
  afterAll(async () => Promise.all([admin?.end(), clientA?.end(), clientB?.end()]));

  it('enforces org RLS, CAS, explicit null, and config/value serialization', async () => {
    const org = `custom-prop-${randomUUID()}`;
    const otherOrg = `custom-prop-other-${randomUUID()}`;
    const actor = randomUUID();
    const ctxA = { tenantId: org, profileId: actor, db: dbA! };
    const ctxB = { tenantId: org, profileId: actor, db: dbB! };
    try {
      const property = await createCustomProperty(ctxA, {
        tableId: 'pos.catalog',
        label: 'Quality score',
        rules: { type: 'number', min: 0, max: 100, precision: 0 },
        hasDefault: true,
        defaultValue: 7,
      });
      expect(await listCustomProperties({ ...ctxA, tenantId: otherOrg }, 'pos.catalog')).toEqual(
        [],
      );
      const absent = await readCustomPropertyValues(ctxA, 'pos.catalog', ['row-1']);
      expect(absent['row-1'][property.id]).toMatchObject({
        present: false,
        value: null,
        effectiveValue: 7,
        version: 0,
      });
      const cleared = await putCustomPropertyValue(
        ctxA,
        'pos.catalog',
        property.id,
        'row-1',
        null,
        0,
      );
      expect(cleared).toMatchObject({
        present: true,
        value: null,
        effectiveValue: null,
        version: 1,
      });
      await expect(
        putCustomPropertyValue(ctxA, 'pos.catalog', property.id, 'row-1', 2, 0),
      ).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
      const competingWrites = await Promise.allSettled([
        putCustomPropertyValue(ctxA, 'pos.catalog', property.id, 'row-1', 3, 1),
        putCustomPropertyValue(ctxB, 'pos.catalog', property.id, 'row-1', 4, 1),
      ]);
      expect(competingWrites.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(competingWrites.filter((r) => r.status === 'rejected')).toHaveLength(1);

      await admin!`insert into app_table_properties(org_id,table_id,label,rules,has_default,version,created_by,updated_by)
        values(${otherOrg},'pos.catalog','Foreign','{"type":"boolean"}'::jsonb,0,1,${actor},${actor})`;
      const unfiltered = await withOrgCore(ctxA, (tx) =>
        tx.select({ orgId: appTableProperties.orgId }).from(appTableProperties),
      );
      expect(unfiltered.every((row) => row.orgId === org)).toBe(true);
      await expect(
        withOrgCore(ctxA, (tx) =>
          tx
            .insert(appTableProperties)
            .values({
              orgId: otherOrg,
              tableId: 'pos.catalog',
              label: 'Forbidden',
              rules: { type: 'boolean' },
              createdBy: actor,
              updatedBy: actor,
            }),
        ),
      ).rejects.toThrow();

      // Both operations lock the same definition row. Whichever commits first makes
      // the other invalid: max=10 cannot coexist with a newly written value of 50.
      const outcomes = await Promise.allSettled([
        updateCustomProperty(ctxA, property.id, {
          tableId: 'pos.catalog',
          expectedVersion: property.version,
          rules: { type: 'number', min: 0, max: 10, precision: 0 },
        }),
        putCustomPropertyValue(ctxB, 'pos.catalog', property.id, 'row-2', 50, 0),
      ]);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    } finally {
      await admin!`delete from app_table_property_values where org_id in (${org},${otherOrg})`;
      await admin!`delete from app_table_properties where org_id in (${org},${otherOrg})`;
    }
  });
});
