import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getChannelCatalog } from './crm-channels.service';
import { sendContactMessage } from './crm-send.service';
import { isModuleEnabled } from './modules.service';

/**
 * Automatic WhatsApp follow-up for form-door leads (spec 041 S4, FR-009).
 * Runs inside `/api/jobs/tick`. One message per (org, door, contact), ever:
 * the row is CLAIMED (unique insert) before anything is sent, and a failed send
 * is never retried — sending a person the same message twice costs more than
 * skipping one (copies `processOrgReminders`).
 * Never log message bodies or phone numbers here: Drizzle errors embed query
 * params, so failures log only the org id and the error name.
 */

/** Stored in `crm_doors.follow_up` (form doors only). */
export const followUpSchema = z
  .object({
    enabled: z.boolean(),
    delayMinutes: z.number().int().min(15).max(10080),
    accountId: z.string().trim().max(200),
    template: z.string().trim().min(1).max(1000),
  })
  .strict();
export type FollowUp = z.infer<typeof followUpSchema>;
/** What `crm_doors.follow_up` holds: the owner's setting plus `enabledAt`, stamped by the
 * database when the switch flips on (re-enabling after off restamps it). Only submissions
 * made at or after it are ever eligible, so switching on never messages past leads. */
export type StoredFollowUp = FollowUp & { enabledAt?: string };

export type FollowUpStatus = 'sending' | 'sent' | 'failed' | 'skipped';
export type FollowUpSkipReason = 'opted_out' | 'no_identity' | 'bought' | 'booked' | 'replied';

export interface FollowUpRunResult {
  orgs: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Due but not claimed: the door's account is no longer visible to the org. Retried next tick. */
  held: number;
  /** Orgs whose sweep threw (isolated; the next org still runs). */
  errors: number;
}

/** Sends + skips claimed per run, across all orgs. */
export const FOLLOW_UP_CAP = 25;
/** Stop claiming after this long; the netcup curl gives the whole tick ~50 s. */
const BUDGET_MS = 40_000;

/** `{nombre}` → the contact's display name, or nothing. */
export function renderFollowUp(template: string, name: string | null): string {
  return template.replaceAll('{nombre}', name?.trim() ?? '').trim();
}

interface CandidateRow {
  submission_id: string;
  door_id: string;
  contact_id: string;
  template: string;
  account_id: string;
  display_name: string | null;
  phone: string | null;
  opted_out: boolean;
  bought: boolean;
  booked: boolean;
  replied: boolean;
}

/** First skip rule that applies, else null (send). Order = most explicit signal first.
 * TODO(handoff): no UI writes `_reminders_opt_out` yet, and a staff OUTBOUND message
 * after the submission does not skip (only inbound does). See proposal 2026-10-24-hub-collection-points-followups. */
export function skipReason(c: CandidateRow): FollowUpSkipReason | null {
  if (c.opted_out) return 'opted_out';
  if (!c.phone) return 'no_identity';
  if (c.bought) return 'bought';
  if (c.booked) return 'booked';
  if (c.replied) return 'replied';
  return null;
}

/** Orgs with ≥1 active form door whose follow-up is on. Must match `dueCandidates`' door predicate. */
async function listFollowUpOrgIds(): Promise<string[]> {
  const rows = (await getCoreDb().execute(sql`
    select distinct org_id from crm_doors
    where kind = 'form' and active and follow_up->>'enabled' = 'true'
  `)) as unknown as Array<{ org_id: string }>;
  return rows.map((r) => r.org_id);
}

/**
 * Due, unclaimed leads of one org: the LATEST consented submission per
 * (door, contact), made after the follow-up was switched on (and in the last 7 days),
 * whose delay has elapsed, plus every skip
 * signal since that submission. Index use: pos_tickets (org_id, submitted_at),
 * messages (org_id, channel, chat_id) covering, crm_door_submissions (org_id, door_id, created_at).
 */
async function dueCandidates(ctx: CoreCtx, now: Date, limit: number): Promise<CandidateRow[]> {
  const org = ctx.tenantId;
  const at = now.toISOString();
  return (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      with latest as (
        select distinct on (s.door_id, s.contact_id) s.id, s.door_id, s.contact_id, s.created_at
        from crm_door_submissions s
        where s.org_id = ${org} and s.consent and s.contact_id is not null
          and s.created_at > ${at}::timestamptz - interval '7 days'
        order by s.door_id, s.contact_id, s.created_at desc
      )
      select l.id as submission_id, l.door_id, l.contact_id,
             d.follow_up->>'template' as template,
             d.follow_up->>'accountId' as account_id,
             c.display_name,
             (select i.external_id from crm_contact_identities i
               where i.org_id = ${org} and i.contact_id = l.contact_id and i.channel = 'whatsapp'
               limit 1) as phone,
             coalesce(c.custom_fields->>'_reminders_opt_out', '') not in ('', 'false', '0') as opted_out,
             exists (select 1 from pos_tickets t
               where t.org_id = ${org} and t.crm_contact_id = l.contact_id
                 and t.status = 'submitted' and t.submitted_at > l.created_at) as bought,
             exists (select 1 from sched_bookings b
               where b.org_id = ${org} and b.crm_contact_id = l.contact_id
                 and b.created_at > l.created_at) as booked,
             exists (select 1 from crm_contact_identities mi
               join messages m on m.org_id = ${org} and m.channel = mi.channel and m.chat_id = mi.external_id
               where mi.org_id = ${org} and mi.contact_id = l.contact_id
                 and m.is_bot is not true and m.direction = 'inbound'
                 and coalesce(m.occurred_at, m.created_at) > l.created_at) as replied
      from latest l
      join crm_doors d on d.id = l.door_id and d.org_id = ${org}
      join crm_contacts c on c.id = l.contact_id and c.org_id = ${org} and c.deleted_at is null
      where d.kind = 'form' and d.active and d.follow_up->>'enabled' = 'true'
        and l.created_at >= (d.follow_up->>'enabledAt')::timestamptz
        and l.created_at + make_interval(mins => greatest(15, (d.follow_up->>'delayMinutes')::int))
            <= ${at}::timestamptz
        and not exists (select 1 from crm_door_followups f
          where f.org_id = ${org} and f.door_id = l.door_id and f.contact_id = l.contact_id)
      order by l.created_at
      limit ${limit}
    `),
  )) as unknown as CandidateRow[];
}

/** Claim the (org, door, contact) slot. False = another tick (or an earlier run) has it. */
async function claim(
  ctx: CoreCtx,
  c: CandidateRow,
  status: 'sending' | 'skipped',
  reason: FollowUpSkipReason | null,
): Promise<boolean> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      insert into crm_door_followups (org_id, door_id, contact_id, submission_id, status, reason)
      values (${ctx.tenantId}, ${c.door_id}, ${c.contact_id}, ${c.submission_id}, ${status}, ${reason})
      on conflict (org_id, door_id, contact_id) do nothing
      returning id
    `),
  )) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

async function finalize(
  ctx: CoreCtx,
  c: CandidateRow,
  status: 'sent' | 'failed',
  fields: { recipient: string; content: string; error?: string },
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      update crm_door_followups
      set status = ${status}, recipient = ${fields.recipient}, content = ${fields.content},
          error = ${fields.error ?? null}, sent_at = ${status === 'sent' ? sql`now()` : null}
      where org_id = ${ctx.tenantId} and door_id = ${c.door_id} and contact_id = ${c.contact_id}
    `),
  );
}

/** Whatsapp account ids the org may send from, or null when the gateway did not answer. */
async function visibleAccounts(ctx: CoreCtx): Promise<Set<string> | null> {
  const catalog = await getChannelCatalog(ctx);
  if (!catalog) return null;
  return new Set(catalog.accounts.filter((a) => a.channel === 'whatsapp').map((a) => a.accountId));
}

async function runOrg(
  ctx: CoreCtx,
  now: Date,
  result: FollowUpRunResult,
  deadline: number,
  budget: { left: number },
): Promise<void> {
  if (!(await isModuleEnabled(ctx, 'crm'))) return;
  const candidates = await dueCandidates(ctx, now, budget.left);
  if (!candidates.length) return;
  // Re-check at send time: an account re-tagged to another org since the PUT
  // must not speak for this one. An unreachable gateway (null) cannot send
  // either; the send then fails and is recorded, as the spec asks.
  const accounts = await visibleAccounts(ctx);
  for (const c of candidates) {
    if (budget.left <= 0 || Date.now() > deadline) return;
    if (accounts && !accounts.has(c.account_id)) {
      result.held += 1;
      continue;
    }
    budget.left -= 1;
    const reason = skipReason(c);
    if (!(await claim(ctx, c, reason ? 'skipped' : 'sending', reason))) continue;
    if (reason) {
      result.skipped += 1;
      continue;
    }
    const content = renderFollowUp(c.template, c.display_name);
    const recipient = c.phone as string;
    try {
      await sendContactMessage(
        ctx,
        c.contact_id,
        'whatsapp',
        content,
        `door-fu-${c.door_id}-${c.contact_id}`,
        {
          accountId: c.account_id,
        },
      );
      // shortcut: a ledger-insert failure after a successful gateway send lands
      // as `failed` (sendContactMessage throws); upgrade if the panel misleads.
      await finalize(ctx, c, 'sent', { recipient, content });
      result.sent += 1;
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await finalize(ctx, c, 'failed', { recipient, content, error });
      result.failed += 1;
    }
  }
}

/** Entry point wired into GET /api/jobs/tick. Never throws per org; bounded by cap + time. */
export async function runDoorFollowUps(now: Date = new Date()): Promise<FollowUpRunResult> {
  const result: FollowUpRunResult = { orgs: 0, sent: 0, failed: 0, skipped: 0, held: 0, errors: 0 };
  const deadline = Date.now() + BUDGET_MS;
  const budget = { left: FOLLOW_UP_CAP };
  const db = getCoreDb();
  for (const orgId of await listFollowUpOrgIds()) {
    if (budget.left <= 0 || Date.now() > deadline) break;
    result.orgs += 1;
    try {
      await runOrg({ db, tenantId: orgId }, now, result, deadline, budget);
    } catch (err) {
      result.errors += 1;
      console.error(
        '[door-followups] org failed',
        orgId,
        err instanceof Error ? err.name : 'error',
      );
    }
  }
  if (result.held)
    console.warn('[door-followups] held: account not visible to its org', result.held);
  return result;
}

// ── Hub API (GET/PUT /api/crm/doors/[id]/follow-up) ──────────────────────────

export interface FollowUpRow {
  id: string;
  contactId: string;
  contactName: string | null;
  status: FollowUpStatus;
  reason: string | null;
  recipient: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** Counts by status + the last 20 rows of one door. */
export async function getFollowUpActivity(
  ctx: CoreCtx,
  doorId: string,
): Promise<{ counts: Record<'sent' | 'failed' | 'skipped', number>; rows: FollowUpRow[] }> {
  const [counts, rows] = await withOrgCore(ctx, async (tx) => [
    (await tx.execute(sql`
      select status, count(*)::int as n from crm_door_followups
      where org_id = ${ctx.tenantId} and door_id = ${doorId}
      group by status
    `)) as unknown as Array<{ status: string; n: number }>,
    (await tx.execute(sql`
      select f.id, f.contact_id, c.display_name, f.status, f.reason, f.recipient, f.error,
             f.created_at, f.sent_at
      from crm_door_followups f
      left join crm_contacts c on c.id = f.contact_id and c.org_id = f.org_id
      where f.org_id = ${ctx.tenantId} and f.door_id = ${doorId}
      order by f.created_at desc
      limit 20
    `)) as unknown as Array<Record<string, unknown>>,
  ]);
  const by = Object.fromEntries(counts.map((r) => [r.status, Number(r.n)]));
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    counts: { sent: by.sent ?? 0, failed: by.failed ?? 0, skipped: by.skipped ?? 0 },
    rows: rows.map((r) => ({
      id: String(r.id),
      contactId: String(r.contact_id),
      contactName: (r.display_name as string | null) ?? null,
      status: r.status as FollowUpStatus,
      reason: (r.reason as string | null) ?? null,
      recipient: (r.recipient as string | null) ?? null,
      error: (r.error as string | null) ?? null,
      createdAt: iso(r.created_at) as string,
      sentAt: iso(r.sent_at),
    })),
  };
}

/**
 * Writes `crm_doors.follow_up` on a form door and returns what was stored, or null when
 * no such form door exists in the org. `enabledAt` uses the database clock (the same one
 * that stamps submissions): kept while the follow-up stays on, set to now() when it flips
 * on, dropped when it is switched off.
 */
export async function setFollowUp(
  ctx: CoreCtx,
  doorId: string,
  followUp: FollowUp,
): Promise<StoredFollowUp | null> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      update crm_doors set
        follow_up = ${JSON.stringify(followUp)}::jsonb || case
          when not ${followUp.enabled} then '{}'::jsonb
          when follow_up->>'enabled' = 'true' and follow_up ? 'enabledAt'
            then jsonb_build_object('enabledAt', follow_up->'enabledAt')
          else jsonb_build_object('enabledAt', now())
        end,
        updated_at = now()
      where org_id = ${ctx.tenantId} and id = ${doorId} and kind = 'form'
      returning follow_up
    `),
  )) as unknown as Array<{ follow_up: StoredFollowUp }>;
  return rows[0]?.follow_up ?? null;
}
