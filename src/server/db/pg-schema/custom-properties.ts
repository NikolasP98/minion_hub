import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const appTableProperties = pgTable(
  'app_table_properties',
  {
    id: uuid('id').notNull().defaultRandom(),
    orgId: text('org_id').notNull(),
    tableId: text('table_id').notNull(),
    /** Stable identity for explicitly installed templates. Organization-owned
     * edits and archive state never change this key. Null for ordinary fields. */
    templateKey: text('template_key'),
    label: text('label').notNull(),
    description: text('description'),
    rules: jsonb('rules').notNull(),
    hasDefault: integer('has_default').notNull().default(0),
    defaultValue: jsonb('default_value'),
    presentation: jsonb('presentation'),
    version: integer('version').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    index('app_table_properties_org_table_idx').on(t.orgId, t.tableId, t.archivedAt),
    uniqueIndex('app_table_properties_active_label_uniq')
      .on(t.orgId, t.tableId, sql`lower(${t.label})`)
      .where(sql`${t.archivedAt} is null`),
    uniqueIndex('app_table_properties_template_key_uniq')
      .on(t.orgId, t.tableId, t.templateKey)
      .where(sql`${t.templateKey} is not null`),
  ],
);

export const appTablePropertyValues = pgTable(
  'app_table_property_values',
  {
    orgId: text('org_id').notNull(),
    propertyId: uuid('property_id').notNull(),
    recordId: text('record_id').notNull(),
    value: jsonb('value').notNull(),
    version: integer('version').notNull().default(1),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.propertyId, t.recordId] }),
    foreignKey({
      columns: [t.orgId, t.propertyId],
      foreignColumns: [appTableProperties.orgId, appTableProperties.id],
      name: 'app_table_property_values_property_fk',
    }),
    index('app_table_property_values_record_idx').on(t.orgId, t.recordId),
  ],
);
