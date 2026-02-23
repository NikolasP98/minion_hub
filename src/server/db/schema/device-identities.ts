import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';

export const deviceIdentities = sqliteTable('device_identities', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenants.id, { onDelete: 'cascade' })
		.unique(),
	deviceId: text('device_id').notNull(),
	publicKeyPem: text('public_key_pem').notNull(),
	privateKeyPem: text('private_key_pem').notNull(),
	createdAt: integer('created_at').notNull(),
});
