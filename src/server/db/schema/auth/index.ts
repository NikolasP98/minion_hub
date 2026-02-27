/**
 * Better Auth schema tables.
 * Generated manually based on Better Auth 1.x field definitions.
 * Provider: sqlite, plugins: emailAndPassword, google OAuth, jwt, organization
 */
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ── Core: user ──────────────────────────────────────────────────────────────
export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ── Core: session ────────────────────────────────────────────────────────────
export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		// Added by organization plugin
		activeOrganizationId: text('active_organization_id'),
	},
	(t) => [index('idx_session_user').on(t.userId)],
);

// ── Core: account ────────────────────────────────────────────────────────────
export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
		scope: text('scope'),
		password: text('password'),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [index('idx_account_user').on(t.userId)],
);

// ── Core: verification ────────────────────────────────────────────────────────
export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [index('idx_verification_identifier').on(t.identifier)],
);

// ── JWT plugin: jwks ─────────────────────────────────────────────────────────
export const jwks = sqliteTable('jwks', {
	id: text('id').primaryKey(),
	publicKey: text('public_key').notNull(),
	privateKey: text('private_key').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ── Organization plugin: organization ────────────────────────────────────────
export const organization = sqliteTable('organization', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	slug: text('slug').unique(),
	logo: text('logo'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	metadata: text('metadata'),
});

// ── Organization plugin: member ───────────────────────────────────────────────
export const member = sqliteTable(
	'member',
	{
		id: text('id').primaryKey(),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [
		index('idx_member_org').on(t.organizationId),
		index('idx_member_user').on(t.userId),
	],
);

// ── Organization plugin: invitation ──────────────────────────────────────────
export const invitation = sqliteTable(
	'invitation',
	{
		id: text('id').primaryKey(),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		role: text('role'),
		status: text('status').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		inviterId: text('inviter_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [index('idx_invitation_org').on(t.organizationId)],
);
