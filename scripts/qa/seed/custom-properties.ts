import type { SeedContext } from './db';
import { matrixUuid, personaEmail } from './ids';
import { ORG_BUSINESS } from './tenancy';
import { ITEM_LOW_STOCK, ITEM_TRACKED } from './stock';

const definitions = [
  {
    matrixId: 'custom.property.text',
    label: 'QA Note',
    rules: { type: 'text', maxLength: 120 },
    hasDefault: 0,
    defaultValue: null,
  },
  {
    matrixId: 'custom.property.number-default',
    label: 'QA Threshold',
    rules: { type: 'number', min: 0, max: 100, precision: 1 },
    hasDefault: 1,
    defaultValue: 12.5,
  },
  {
    matrixId: 'custom.property.date',
    label: 'QA Review date',
    rules: { type: 'date', min: '2026-01-01', max: '2027-12-31' },
    hasDefault: 0,
    defaultValue: null,
  },
  {
    matrixId: 'custom.property.boolean-false',
    label: 'QA Flag',
    rules: { type: 'boolean' },
    hasDefault: 0,
    defaultValue: null,
  },
  {
    matrixId: 'custom.property.select',
    label: 'QA Priority',
    rules: {
      type: 'select',
      options: [
        {
          id: matrixUuid('custom.property.select', 'high'),
          label: 'High',
          color: '#ef4444',
          archivedAt: null,
        },
        {
          id: matrixUuid('custom.property.select', 'legacy'),
          label: 'Legacy',
          color: '#6b7280',
          archivedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    },
    hasDefault: 0,
    defaultValue: null,
  },
  {
    matrixId: 'custom.property.multi-select-empty',
    label: 'QA Labels',
    rules: {
      type: 'multi_select',
      maxSelections: 2,
      options: [
        {
          id: matrixUuid('custom.property.multi-select-empty', 'first'),
          label: 'First',
          color: '#3b82f6',
          archivedAt: null,
        },
        {
          id: matrixUuid('custom.property.multi-select-empty', 'second'),
          label: 'Second',
          color: '#10b981',
          archivedAt: null,
        },
      ],
    },
    hasDefault: 0,
    defaultValue: null,
  },
] as const;

export async function seed(ctx: SeedContext): Promise<void> {
  const [owner] = await ctx.sql<{ id: string }[]>`
    select id from profiles where email = ${personaEmail('tenancy.user.owner')} limit 1
  `;
  if (!owner) throw new Error('custom properties seed requires tenancy.user.owner');

  for (const definition of definitions) {
    const id = matrixUuid(definition.matrixId);
    await ctx.sql`
      insert into app_table_properties
        (id, org_id, table_id, label, description, rules, has_default, default_value,
         version, created_by, updated_by)
      values
        (${id}, ${ORG_BUSINESS}, 'stock.items', ${definition.label},
         'Deterministic custom-column QA fixture', ${ctx.sql.json(definition.rules)},
         ${definition.hasDefault}, ${definition.defaultValue == null ? null : ctx.sql.json(definition.defaultValue)}, 1, ${owner.id}, ${owner.id})
      on conflict (org_id, id) do update set
        table_id = excluded.table_id,
        label = excluded.label,
        description = excluded.description,
        rules = excluded.rules,
        has_default = excluded.has_default,
        default_value = excluded.default_value,
        updated_by = excluded.updated_by
    `;
    ctx.register(definition.matrixId, {
      table: 'app_table_properties',
      where: { org_id: ORG_BUSINESS, id },
    });
  }

  const values: ReadonlyArray<{ matrixId: string; recordId: string; value: unknown }> = [
    { matrixId: 'custom.property.text', recordId: ITEM_LOW_STOCK, value: 'Seeded note' },
    { matrixId: 'custom.property.date', recordId: ITEM_LOW_STOCK, value: '2026-10-15' },
    { matrixId: 'custom.property.boolean-false', recordId: ITEM_LOW_STOCK, value: false },
    {
      matrixId: 'custom.property.select',
      recordId: ITEM_LOW_STOCK,
      value: matrixUuid('custom.property.select', 'high'),
    },
    { matrixId: 'custom.property.multi-select-empty', recordId: ITEM_LOW_STOCK, value: [] },
    { matrixId: 'custom.property.text', recordId: ITEM_TRACKED, value: null },
  ];
  for (const fixture of values) {
    const propertyId = matrixUuid(fixture.matrixId);
    const jsonValue = JSON.stringify(fixture.value);
    await ctx.sql`
      insert into app_table_property_values
        (org_id, property_id, record_id, value, version, created_by, updated_by)
      values
        (${ORG_BUSINESS}, ${propertyId}, ${fixture.recordId},
         ${jsonValue}::jsonb, 1, ${owner.id}, ${owner.id})
      on conflict (org_id, property_id, record_id) do update set
        value = excluded.value,
        updated_by = excluded.updated_by
    `;
  }

  ctx.register('custom.value.false', {
    table: 'app_table_property_values',
    where: {
      org_id: ORG_BUSINESS,
      property_id: matrixUuid('custom.property.boolean-false'),
      record_id: ITEM_LOW_STOCK,
    },
  });
  ctx.register('custom.value.explicit-null', {
    table: 'app_table_property_values',
    where: {
      org_id: ORG_BUSINESS,
      property_id: matrixUuid('custom.property.text'),
      record_id: ITEM_TRACKED,
    },
  });
  ctx.register('custom.value.default-absent', {
    table: 'app_table_property_values',
    where: {
      org_id: ORG_BUSINESS,
      property_id: matrixUuid('custom.property.number-default'),
      record_id: ITEM_LOW_STOCK,
    },
    expect: 'absent',
  });
}
