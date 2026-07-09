import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  emailLedger,
  emailLedgerSettings,
  type EmailLedgerRow,
} from '$server/db/pg-schema/email-ledger';

export const DEFAULT_RETENTION_DAYS = 180;
const MAX_RETENTION_DAYS = 3650; // 10y ceiling; 0 = keep indefinitely (no expiry)

/** Resolve an org's ledger retention (days). 0 = keep indefinitely. */
export async function getRetentionDays(ctx: CoreCtx): Promise<number> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ days: emailLedgerSettings.retentionDays })
      .from(emailLedgerSettings)
      .where(eq(emailLedgerSettings.orgId, ctx.tenantId))
      .limit(1),
  );
  return row ? row.days : DEFAULT_RETENTION_DAYS;
}

/** Set an org's ledger retention (days). Clamped to [0, MAX]; 0 = keep forever. */
export async function setRetentionDays(ctx: CoreCtx, days: number): Promise<number> {
  const clamped = Math.max(0, Math.min(MAX_RETENTION_DAYS, Math.floor(days)));
  const set = { retentionDays: clamped, updatedAt: new Date() };
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(emailLedgerSettings)
      .values({ orgId: ctx.tenantId, ...set })
      .onConflictDoUpdate({ target: emailLedgerSettings.orgId, set })
      .returning({ days: emailLedgerSettings.retentionDays }),
  );
  return row?.days ?? clamped;
}

export interface EmailLedgerEntry {
  userId?: string | null;
  mailbox: string;
  gmailMessageId: string;
  fromDomain?: string | null;
  subject?: string | null;
  summary?: string | null;
  labels?: string[];
}

/**
 * Upsert one processed-email row. Idempotent on (mailbox, gmail_message_id) — a
 * redelivered notification refreshes labels/summary rather than duplicating.
 * `expires_at` is stamped from the org's retention (null when retention is 0).
 */
export async function recordEntry(ctx: CoreCtx, entry: EmailLedgerEntry): Promise<void> {
  const retentionDays = await getRetentionDays(ctx);
  const expiresAt =
    retentionDays > 0 ? new Date(Date.now() + retentionDays * 86_400_000) : null;
  const values = {
    orgId: ctx.tenantId,
    userId: entry.userId ?? null,
    mailbox: entry.mailbox,
    gmailMessageId: entry.gmailMessageId,
    fromDomain: entry.fromDomain ?? null,
    subject: entry.subject ?? null,
    summary: entry.summary ?? null,
    labels: entry.labels ?? [],
    processedAt: new Date(),
    expiresAt,
  };
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(emailLedger)
      .values(values)
      .onConflictDoUpdate({
        target: [emailLedger.mailbox, emailLedger.gmailMessageId],
        set: {
          fromDomain: values.fromDomain,
          subject: values.subject,
          summary: values.summary,
          labels: values.labels,
          processedAt: values.processedAt,
          expiresAt: values.expiresAt,
        },
      }),
  );
}

/** Recent ledger rows for the org (newest first), optionally filtered by mailbox. */
export async function listEntries(
  ctx: CoreCtx,
  opts: { limit?: number; mailbox?: string } = {},
): Promise<EmailLedgerRow[]> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  return withOrgCore(ctx, (tx) => {
    const where = opts.mailbox
      ? and(eq(emailLedger.orgId, ctx.tenantId), eq(emailLedger.mailbox, opts.mailbox))
      : eq(emailLedger.orgId, ctx.tenantId);
    return tx
      .select()
      .from(emailLedger)
      .where(where)
      .orderBy(desc(emailLedger.processedAt))
      .limit(limit);
  });
}

/** Erase all of a user's ledger rows across the org (right to erasure). */
export async function eraseForUser(ctx: CoreCtx, userId: string): Promise<number> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .delete(emailLedger)
      .where(and(eq(emailLedger.orgId, ctx.tenantId), eq(emailLedger.userId, userId)))
      .returning({ id: emailLedger.id }),
  );
  return rows.length;
}

/**
 * Delete expired rows across ALL orgs (storage limitation). Runs from the cron
 * tick as the core role (bypasses RLS on purpose — a global sweep can't set a
 * single org GUC). Returns the number of rows removed.
 */
export async function purgeExpired(): Promise<number> {
  const db = getCoreDb();
  const rows = await db
    .delete(emailLedger)
    .where(lt(emailLedger.expiresAt, sql`now()`))
    .returning({ id: emailLedger.id });
  return rows.length;
}
