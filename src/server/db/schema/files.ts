import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { organization, user } from './auth';

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    b2FileKey: text('b2_file_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    category: text('category').notNull().default('general'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_files_tenant').on(t.tenantId),
  ],
);
