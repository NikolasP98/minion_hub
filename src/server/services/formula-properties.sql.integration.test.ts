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

  it('stores presentation under CAS while preserving formula AST and stale secondary references', async () => {
    const orgId = `formula-presentation-${randomUUID()}`;
    const actor = randomUUID();
    const ctx = { tenantId: orgId, profileId: actor, db: db! };
    const tableId = 'stock.items' as const;
    const nativeSources = [
      {
        id: 'native:test:sale-price',
        label: 'Sale price',
        aliases: [],
        type: {
          kind: 'number' as const,
          dimension: 'money' as const,
          currency: 'PEN',
          basis: 'item',
        },
        nullable: true,
        source: 'native' as const,
      },
    ];
    const context = async (restrictedDefinitionIds: string[] = []) => {
      const definitions = await listCustomProperties(ctx, tableId);
      return {
        nativeSources,
        restrictedDefinitionIds,
        catalogRevision: formulaCatalogRevision(
          definitions.filter((definition) => !restrictedDefinitionIds.includes(definition.id)),
          nativeSources,
        ),
      };
    };
    const numberFormat = {
      style: 'decimal' as const,
      decimals: 2,
      currencyDisplay: 'symbol' as const,
      percentScale: 'whole' as const,
    };
    try {
      await expect(
        createCustomProperty(
          ctx,
          {
            tableId,
            label: 'Money with decimal format',
            rules: { type: 'formula', expression: '"Sale price"' },
            hasDefault: false,
            presentation: {
              version: 1,
              number: numberFormat,
              tone: 'none',
              secondary: null,
            },
          },
          await context(),
        ),
      ).rejects.toMatchObject({ status: 422, code: 'presentation_incompatible' });
      const input = await createCustomProperty(ctx, {
        tableId,
        label: 'Presentation input',
        rules: { type: 'number', min: null, max: null, precision: 2 },
        hasDefault: false,
      });
      const secondary = await createCustomProperty(
        ctx,
        {
          tableId,
          label: 'Presentation secondary',
          rules: { type: 'formula', expression: '"Presentation input" + 1' },
          hasDefault: false,
        },
        await context(),
      );
      const primary = await createCustomProperty(
        ctx,
        {
          tableId,
          label: 'Presentation primary',
          rules: { type: 'formula', expression: '"Presentation input" + 2' },
          hasDefault: false,
          presentation: {
            version: 1,
            number: numberFormat,
            tone: 'sign',
            secondary: { propertyId: secondary.id, format: numberFormat },
          },
        },
        await context(),
      );
      if (primary.rules.type !== 'formula') throw new Error('formula fixture expected');
      const originalAst = primary.rules.ast;

      const formatted = await updateCustomProperty(
        ctx,
        primary.id,
        {
          tableId,
          expectedVersion: primary.version,
          presentation: { ...primary.presentation!, tone: 'none' },
        },
        await context(),
      );
      expect(formatted.presentation?.tone).toBe('none');
      expect(formatted.rules).toMatchObject({ type: 'formula', ast: originalAst });
      await expect(
        updateCustomProperty(
          ctx,
          primary.id,
          { tableId, expectedVersion: primary.version, presentation: null },
          await context(),
        ),
      ).rejects.toMatchObject({ status: 409, code: 'version_conflict' });

      const stalePresentationContext = await context();
      const driftedSecondary = await updateCustomProperty(
        ctx,
        secondary.id,
        {
          tableId,
          expectedVersion: secondary.version,
          rules: { type: 'formula', expression: "'ready'" },
        },
        await context(),
      );
      expect(driftedSecondary.rules).toMatchObject({ type: 'formula' });
      await expect(
        updateCustomProperty(
          ctx,
          primary.id,
          {
            tableId,
            expectedVersion: formatted.version,
            presentation: formatted.presentation,
          },
          stalePresentationContext,
        ),
      ).rejects.toMatchObject({ status: 409, code: 'catalog_changed' });
      const preserved = await updateCustomProperty(
        ctx,
        primary.id,
        { tableId, expectedVersion: formatted.version, label: 'Presentation renamed' },
        await context([secondary.id]),
      );
      expect(preserved.presentation?.secondary?.propertyId).toBe(secondary.id);
      await expect(
        updateCustomProperty(
          ctx,
          primary.id,
          { tableId, expectedVersion: preserved.version, presentation: null },
          await context([secondary.id]),
        ),
      ).rejects.toMatchObject({ status: 422, code: 'presentation_restricted' });
      expect(input.type).toBe('number');
    } finally {
      await admin!`delete from app_table_property_values where org_id = ${orgId}`;
      await admin!`delete from app_table_properties where org_id = ${orgId}`;
    }
  });
});
