import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth';

/**
 * Canonical per-user identity row. Covers OAuth providers (kind='oauth',
 * e.g. google) and channel identities (kind='channel', e.g. whatsapp/telegram).
 * Secret material (OAuth ADC blob) is stored app-level-encrypted as hex text
 * in secretCiphertext/secretIv (same scheme as servers.token); null for
 * channel identities that carry no secret.
 */
export const userIdentities = sqliteTable(
  'user_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name'),
    scope: text('scope'),
    secretCiphertext: text('secret_ciphertext'),
    secretIv: text('secret_iv'),
    expiresAt: integer('expires_at'),
    verifiedAt: integer('verified_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_user_identity_unique').on(t.provider, t.externalId),
    index('idx_user_identity_user').on(t.userId),
    // Covers the (userId, provider) lookups in identity.service /
    // channel-identity.service (Google credential read, channel-key filters).
    index('idx_user_identity_user_provider').on(t.userId, t.provider),
  ],
);
