import { and, eq, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import { notifRules, notifLog, type NotifRule } from '$server/db/pg-notifications-schema';
import { gatewayCall } from '$lib/server/gateway-rpc';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * Allowlist of triggerable tables → their timestamp columns. Doubles as the
 * security gate: a rule's trigger_table MUST be a key here (the name is then
 * used in raw SQL, so it can never be user-controlled). Add a table = one line.
 */
const TABLE_META: Record<string, { created: string; updated: string; dateFields: string[] }> = {
  support_issues: { created: 'created_at', updated: 'updated_at', dateFields: ['created_at', 'response_by', 'resolution_by', 'resolved_at'] },
  sales_orders: { created: 'created_at', updated: 'updated_at', dateFields: ['created_at'] },
  crm_contacts: { created: 'created_at', updated: 'updated_at', dateFields: ['created_at'] },
  sched_bookings: { created: 'created_at', updated: 'updated_at', dateFields: ['created_at', 'start_time', 'end_time'] },
  fin_invoices: { created: 'created_at', updated: 'synced_at', dateFields: ['issued_at', 'synced_at'] },
};

// Belt-and-suspenders: a column identifier can only ever be a plain snake_case name.
const COL_RE = /^[a-z_][a-z0-9_]*$/;

export function isTriggerTableAllowed(t: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABLE_META, t);
}

/** Allowlisted trigger tables + their date-offset columns — drives the rules UI. */
export const NOTIF_TABLES: Array<{ table: string; dateFields: string[] }> = Object.entries(TABLE_META).map(
  ([table, m]) => ({ table, dateFields: m.dateFields }),
);

/** A date_offset rule's dateField must be an allowlisted timestamp column for
 *  its table (it is interpolated into raw SQL — never trust the rule value). */
export function isDateFieldAllowed(table: string, field: string | null | undefined): boolean {
  const meta = TABLE_META[table];
  return !!field && !!meta && meta.dateFields.includes(field) && COL_RE.test(field);
}

export interface Filter {
  field: string;
  op: 'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'lt';
  value: unknown;
}

/** Pure: AND-evaluate a filter array against a row. Empty = always match. */
export function evaluateCondition(filters: Filter[], row: Record<string, unknown>): boolean {
  return filters.every((f) => {
    const v = row[f.field];
    switch (f.op) {
      case 'eq':
        return v === f.value;
      case 'neq':
        return v !== f.value;
      case 'contains':
        return String(v ?? '').toLowerCase().includes(String(f.value).toLowerCase());
      case 'in':
        return Array.isArray(f.value) && f.value.includes(v);
      case 'gt':
        return Number(v) > Number(f.value);
      case 'lt':
        return Number(v) < Number(f.value);
      default:
        return false;
    }
  });
}

/** Pure: {{field}} interpolation from a row (missing → ''). */
export function renderTemplate(template: string, row: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = row[key];
    return v != null ? String(v) : '';
  });
}

function resolveRecipients(
  recipients: Array<{ type: string; value: string }>,
  row: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const r of recipients) {
    if (r.type === 'static') out.push(r.value);
    else if (r.type === 'field') {
      const v = row[r.value];
      if (v != null && String(v).trim()) out.push(String(v));
    }
  }
  return [...new Set(out)];
}

/** Orgs with at least one enabled rule (bypass-RLS read for the cron fan-out). */
export async function listEnabledNotifOrgs(): Promise<string[]> {
  const rows = await getCoreDb()
    .selectDistinct({ orgId: notifRules.orgId })
    .from(notifRules)
    .where(eq(notifRules.enabled, true));
  return rows.map((r) => r.orgId);
}

// ── Rule CRUD (settings) ──────────────────────────────────────────────────────
export function listRules(ctx: CoreCtx): Promise<NotifRule[]> {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(notifRules).where(eq(notifRules.orgId, ctx.tenantId)),
  );
}

export type NewRuleInput = Omit<
  typeof notifRules.$inferInsert,
  'id' | 'orgId' | 'lastRunAt' | 'createdAt' | 'updatedAt'
>;

export async function createRule(ctx: CoreCtx, input: NewRuleInput): Promise<NotifRule> {
  if (!isTriggerTableAllowed(input.triggerTable)) throw new Error('trigger_table not allowed');
  if (input.triggerEvent === 'date_offset' && !isDateFieldAllowed(input.triggerTable, input.dateField))
    throw new Error('date_field not allowed for this table');
  const [row] = await withOrgCore(ctx, (tx) =>
    // lastRunAt = now so the rule never fires on pre-existing rows.
    tx.insert(notifRules).values({ ...input, orgId: ctx.tenantId, lastRunAt: new Date() }).returning(),
  );
  return row;
}

export async function updateRule(
  ctx: CoreCtx,
  id: string,
  patch: Partial<NewRuleInput>,
): Promise<NotifRule | null> {
  if (patch.triggerTable && !isTriggerTableAllowed(patch.triggerTable)) throw new Error('trigger_table not allowed');
  // If a dateField is being set, it must be allowlisted for the (given) table.
  // The getCandidates sink re-checks regardless, so this is defense-in-depth.
  if (patch.dateField != null && patch.triggerTable && !isDateFieldAllowed(patch.triggerTable, patch.dateField))
    throw new Error('date_field not allowed for this table');
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(notifRules)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(notifRules.id, id), eq(notifRules.orgId, ctx.tenantId)))
      .returning(),
  );
  return row ?? null;
}

export async function deleteRule(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.delete(notifRules).where(and(eq(notifRules.id, id), eq(notifRules.orgId, ctx.tenantId))),
  );
}

/** Rows that newly entered the rule's trigger window (lastRun, now]. */
async function getCandidates(
  tx: CoreTx,
  rule: NotifRule,
  now: Date,
): Promise<Array<Record<string, unknown>>> {
  const meta = TABLE_META[rule.triggerTable];
  if (!meta) return [];
  const table = sql.raw(rule.triggerTable);
  // First run (lastRun null) → only act on the very recent past, never history.
  const lastRun = rule.lastRunAt ?? new Date(now.getTime() - 5 * 60_000);

  let instant: ReturnType<typeof sql.raw>;
  if (rule.triggerEvent === 'insert') instant = sql.raw(meta.created);
  else if (rule.triggerEvent === 'update') instant = sql.raw(meta.updated);
  else if (rule.triggerEvent === 'date_offset') {
    // SQLi guard: dateField is interpolated into raw SQL — require it be an
    // allowlisted column for this table (+ regex) before use.
    if (!isDateFieldAllowed(rule.triggerTable, rule.dateField) || rule.dateOffsetMins == null) return [];
    // notify instant = date_field + offset minutes (offset negative = before).
    instant = sql.raw(`(${rule.dateField} + (${Number(rule.dateOffsetMins)} || ' minutes')::interval)`);
  } else return [];

  const rows = (await tx.execute(sql`
    select * from ${table}
    where org_id = current_setting('app.current_org_id', true)
      and ${instant} > ${lastRun} and ${instant} <= ${now}
    limit 500
  `)) as unknown as Array<Record<string, unknown>>;
  return rows;
}

export interface NotifRunResult {
  sent: number;
  failed: number;
  skipped: number;
}

export async function processOrgNotifications(ctx: CoreCtx, now: Date): Promise<NotifRunResult> {
  const res: NotifRunResult = { sent: 0, failed: 0, skipped: 0 };
  const rules = await withOrgCore(ctx, (tx) =>
    tx.select().from(notifRules).where(and(eq(notifRules.orgId, ctx.tenantId), eq(notifRules.enabled, true))),
  );

  for (const rule of rules) {
    if (!isTriggerTableAllowed(rule.triggerTable)) continue;
    const candidates = await withOrgCore(ctx, (tx) => getCandidates(tx, rule, now));
    const filters = (rule.condition as Filter[]) ?? [];
    const recipientSpec = (rule.recipients as Array<{ type: string; value: string }>) ?? [];

    for (const row of candidates) {
      if (!evaluateCondition(filters, row)) continue;
      const entityId = String(row.id ?? '');
      if (!entityId) continue;
      const triggerKey = rule.triggerEvent === 'update' ? `update:${row.updated_at ?? ''}` : rule.triggerEvent;
      const recipients = resolveRecipients(recipientSpec, row);
      const text = renderTemplate(rule.template, row);

      for (const to of recipients) {
        // Claim (dedup) — INSERT … ON CONFLICT DO NOTHING on (rule, entity, key+recipient).
        const claimed = await withOrgCore(ctx, (tx) =>
          tx
            .insert(notifLog)
            .values({
              orgId: ctx.tenantId,
              ruleId: rule.id,
              entityId,
              triggerKey: `${triggerKey}:${to}`,
              channel: rule.channel,
              recipient: to,
              content: text,
              status: 'sent',
            })
            .onConflictDoNothing()
            .returning({ id: notifLog.id }),
        );
        if (!claimed.length) {
          res.skipped++;
          continue;
        }
        try {
          await gatewayCall('channels.send', {
            channel: rule.channel,
            to,
            text,
            ...(rule.accountId ? { accountId: rule.accountId } : {}),
            idempotencyKey: `notif-${rule.id}-${entityId}-${triggerKey}-${to}`,
          });
          res.sent++;
        } catch (e) {
          res.failed++;
          await withOrgCore(ctx, (tx) =>
            tx
              .update(notifLog)
              .set({ status: 'failed', error: e instanceof Error ? e.message : String(e) })
              .where(and(eq(notifLog.ruleId, rule.id), eq(notifLog.entityId, entityId), eq(notifLog.triggerKey, `${triggerKey}:${to}`))),
          );
        }
      }
    }

    // Advance the rule's window watermark.
    await withOrgCore(ctx, (tx) =>
      tx.update(notifRules).set({ lastRunAt: now }).where(eq(notifRules.id, rule.id)),
    );
  }
  return res;
}
