import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import {
  createCustomProperty,
  listCustomProperties,
  putCustomPropertyValue,
  setCustomPropertyArchived,
  updateCustomProperty,
} from './custom-properties.service';
import { formulaCatalogRevision } from './formula-properties.service';

const databaseUrl = testDatabaseUrl();
const admin = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const client = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const clientB = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const db = client ? drizzle(client, { schema: pgSchema }) : null;
const dbB = clientB ? drizzle(clientB, { schema: pgSchema }) : null;

describe.runIf(Boolean(databaseUrl))('formula property PostgreSQL graph invariants', () => {
  afterAll(async () => Promise.all([admin?.end(), client?.end(), clientB?.end()]));

  it('survives JSONB type round-trips and rejects cycles and archived dependencies', async () => {
    const orgId = `formula-prop-${randomUUID()}`;
    const actor = randomUUID();
    const ctx = { tenantId: orgId, profileId: actor, db: db! };
    const ctxB = { tenantId: orgId, profileId: actor, db: dbB! };
    const tableId = 'stock.items' as const;
    const context = async () => {
      const definitions = await listCustomProperties(ctx, tableId);
      return {
        nativeSources: [],
        catalogRevision: formulaCatalogRevision(definitions, []),
      };
    };
    try {
      const input = await createCustomProperty(ctx, {
        tableId,
        label: 'Input',
        rules: { type: 'number', min: null, max: null, precision: 2 },
        hasDefault: false,
        defaultValue: null,
      });
      const a = await createCustomProperty(
        ctx,
        {
          tableId,
          label: 'A',
          rules: { type: 'formula', expression: '"Input" + 1' },
          hasDefault: false,
          defaultValue: null,
        },
        await context(),
      );
      const b = await createCustomProperty(
        ctx,
        {
          tableId,
          label: 'B',
          rules: { type: 'formula', expression: '"A" + 1' },
          hasDefault: false,
          defaultValue: null,
        },
        await context(),
      );

      // PostgreSQL JSONB sorts object keys; a semantic type comparison must not
      // reject the persisted output type merely because its key order changed.
      const roundTripped = await updateCustomProperty(
        ctx,
        a.id,
        {
          tableId,
          expectedVersion: a.version,
          rules: { type: 'formula', expression: '"Input" + 2' },
        },
        await context(),
      );
      expect(roundTripped.rules.type).toBe('formula');

      const graphRaceContext = await context();
      const graphRace = await Promise.allSettled([
        updateCustomProperty(
          ctx,
          roundTripped.id,
          {
            tableId,
            expectedVersion: roundTripped.version,
            rules: { type: 'formula', expression: '"B" + 1' },
          },
          graphRaceContext,
        ),
        updateCustomProperty(
          ctxB,
          b.id,
          {
            tableId,
            expectedVersion: b.version,
            rules: { type: 'formula', expression: '"A" + 1' },
          },
          graphRaceContext,
        ),
      ]);
      expect(graphRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(graphRace.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(
        (graphRace.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
      ).toMatchObject({ status: 422, code: 'formula_cycle' });

      const definitionValueRace = await Promise.allSettled([
        updateCustomProperty(ctx, input.id, {
          tableId,
          expectedVersion: input.version,
          rules: { type: 'number', min: 0, max: 10, precision: 2 },
        }),
        putCustomPropertyValue(ctxB, tableId, input.id, 'record-1', 50, 0),
      ]);
      expect(definitionValueRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(definitionValueRace.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(
        setCustomPropertyArchived(ctx, input.id, input.version, true),
      ).rejects.toMatchObject({ status: 409, code: 'formula_dependency_in_use' });
      expect(b.rules.type).toBe('formula');
    } finally {
      await admin!`delete from app_table_property_values where org_id = ${orgId}`;
      await admin!`delete from app_table_properties where org_id = ${orgId}`;
    }
  });
});
