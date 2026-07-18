import { pgTable, text, jsonb, boolean, timestamp, uuid, index, unique } from 'drizzle-orm/pg-core';

export const pulseProposals = pgTable(
  'pulse_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    payload: jsonb('payload')
      .$type<{ tool?: string; args?: Record<string, unknown> } & Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text('status').notNull().default('pending'),
    dedupKey: text('dedup_key').notNull(),
    decidedBy: text('decided_by'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [
    index('pulse_proposals_org_status_idx').on(t.orgId, t.status, t.createdAt),
    unique('pulse_proposals_org_dedup_uq').on(t.orgId, t.dedupKey),
  ],
);

export const pulseSettings = pgTable('pulse_settings', {
  orgId: text('org_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  briefingTime: text('briefing_time').notNull().default('08:00'),
  locale: text('locale').notNull().default('es'),
  channels: text('channels').array().notNull().default(['whatsapp']),
  watch: jsonb('watch')
    .$type<{ email: boolean; whatsapp: boolean; calendar: boolean }>()
    .notNull()
    .default({ email: true, whatsapp: true, calendar: true }),
  autoApprove: jsonb('auto_approve').$type<Record<string, boolean>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PulseProposalRow = typeof pulseProposals.$inferSelect;
export type NewPulseProposalRow = typeof pulseProposals.$inferInsert;
export type PulseSettingsRow = typeof pulseSettings.$inferSelect;
