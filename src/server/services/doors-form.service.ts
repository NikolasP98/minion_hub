import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmDoorSubmissions } from '$server/db/pg-doors-schema';
import { crmContacts } from '$server/db/pg-crm-schema';
import { ensureCrmContact } from './crm-contact-ensure';
import { bumpDoorStat, resolvePublicDoor } from './doors.service';
import { upsertNotification } from './inbox/inbox.service';
import {
  configSchema,
  contactFromValues,
  profileFromValues,
  validateSubmission,
  type ContactProfile,
  type FieldErrorCode,
  type FormConfig,
  type SubmissionRow,
} from '$lib/doors/kinds/form';
import type { Attribution, DoorKey } from '$lib/doors/attribution';
import { maskPii } from '$lib/pii';
import { simulatedActorForOrg } from '$server/auth/simulated-record-scope';

/**
 * Form doors (spec 041 S2): the public write path and the staff read path.
 * Submissions are personal and possibly clinical data: nothing here logs,
 * echoes or reports a submitted value.
 */

export type SubmitFormResult =
  | { status: 'ok'; message: string | null }
  | { status: 'not_found' }
  | { status: 'invalid'; errors: Record<string, FieldErrorCode> };

export interface SubmitFormInput {
  values: unknown;
  consent: boolean;
  attribution?: Attribution | null;
}

/**
 * Validate a public submission against the door's stored config, then find or
 * create the contact and store the submission in ONE org-scoped transaction.
 * Off, unknown, CRM-disabled and non-form doors are all `not_found`.
 */
export async function submitFormDoor(
  slug: string,
  input: SubmitFormInput,
  now: Date = new Date(),
): Promise<SubmitFormResult> {
  const resolved = await resolvePublicDoor(slug);
  if (!resolved || resolved.door.kind !== 'form') return { status: 'not_found' };
  const { ctx, door } = resolved;
  const config = configSchema.parse(door.config);

  const checked = validateSubmission(config, input.values, input.consent);
  if (!checked.ok) return { status: 'invalid', errors: checked.errors };

  const doorKey: DoorKey = `door:${door.id}`;
  // The page's capture is trusted only for this door; otherwise keep just the door and time.
  const attribution: Attribution =
    input.attribution?.door === doorKey
      ? input.attribution
      : { door: doorKey, at: now.toISOString() };
  const who = contactFromValues(config.fields, checked.values);
  const profile = profileFromValues(config.fields, checked.values);
  // The raw lookup below bypasses simulated-owner scoping, so simulations keep the phone/email path only.
  const simulated = !!simulatedActorForOrg(ctx.tenantId);

  const submissionId = randomUUID();
  await withOrgCore(ctx, async (tx) => {
    // DNI is the strongest identity: a returning patient with a new phone is still the same contact.
    const byDni =
      profile.dni && !simulated ? await contactIdByDni(tx, ctx.tenantId, profile.dni) : null;
    const contact = byDni
      ? { id: byDni, created: false }
      : await ensureCrmContact(tx, ctx.tenantId, {
          ...who,
          source: `door:${door.slug}`,
          firstTouch: attribution,
        });
    if (contact && Object.keys(profile).length)
      await fillContactProfile(tx, ctx.tenantId, contact.id, profile);
    await tx.insert(crmDoorSubmissions).values({
      id: submissionId,
      orgId: ctx.tenantId,
      doorId: door.id,
      contactId: contact?.id ?? null,
      payload: checked.values,
      consent: input.consent,
      consentText: input.consent ? config.consentText : null,
      attribution,
    });
  });
  await bumpDoorStat(ctx, doorKey, 'submissions', now);
  // Owners/admins (crm:manage) hear about it once. Body = door + contact name only: the free-text answers may be clinical.
  // shortcut: fixed Spanish strings, no per-viewer locale (same as the inbox rules).
  try {
    await upsertNotification(ctx, {
      scope: 'role',
      orgId: ctx.tenantId,
      capability: 'crm:manage',
      kind: 'crm.door_submission',
      // The bell shows the title only, so it names the door and the contact.
      title: `Nuevo envío · ${door.title} · ${who.name ?? 'Sin nombre'}`,
      body: `${door.title} · ${who.name ?? 'Sin nombre'}`,
      href: `/crm/doors/${door.id}`,
      subjectType: 'door_submission',
      subjectId: submissionId,
      dedupeKey: `door-submission:${submissionId}`,
    });
  } catch (e) {
    console.warn('[doors] submission notification failed', door.slug, (e as Error)?.message);
  }
  return { status: 'ok', message: config.successMessage ?? null };
}

/** Live contact whose DNI (custom field or linked party document) is `dni`; oldest wins. */
async function contactIdByDni(tx: CoreTx, orgId: string, dni: string): Promise<string | null> {
  // shortcut: unindexed custom_fields scan, fine at clinic scale; add an expression index if one org passes ~50k contacts.
  const rows = (await tx.execute(sql`
    select c.id from crm_contacts c
    left join parties p on p.id = c.party_id and p.org_id = c.org_id
    where c.org_id = ${orgId} and c.deleted_at is null
      and (upper(coalesce(c.custom_fields->>'dni', c.custom_fields->>'DNI')) = ${dni}
           or upper(p.doc_number) = ${dni})
    order by c.created_at
    limit 1
  `)) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** Adds DNI / social handles to the contact's custom fields. Values already there win: a form never overwrites the CRM. */
async function fillContactProfile(
  tx: CoreTx,
  orgId: string,
  contactId: string,
  profile: ContactProfile,
): Promise<void> {
  await tx.execute(sql`
    update crm_contacts
    set custom_fields = ${JSON.stringify(profile)}::jsonb || coalesce(custom_fields, '{}'::jsonb),
        updated_at = now()
    where id = ${contactId} and org_id = ${orgId}
  `);
}

/** Field types whose values are never personal (option labels, yes/no). */
const SAFE_TYPES = new Set(['select', 'checkbox']);

/** Masks every value except select/checkbox answers; keys no longer in the config are masked too. */
export function maskSubmissionValues(
  fields: FormConfig['fields'],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const types = new Map(fields.map((f) => [f.key, f.type]));
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      SAFE_TYPES.has(types.get(k) ?? '') ? v : maskPii(String(v ?? '')),
    ]),
  );
}

const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([0-9a-f-]{36})$/i;

/**
 * Newest-first submissions of one door, keyset-paginated. `cursor` is the
 * `nextCursor` of the previous page. `mask` comes from `shouldMaskSensitive`.
 */
export async function listSubmissions(
  ctx: CoreCtx,
  door: { id: string; config: unknown },
  opts: { cursor?: string | null; limit?: number; mask: boolean },
): Promise<{ rows: SubmissionRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 50);
  const cur = opts.cursor ? CURSOR_RE.exec(opts.cursor) : null;
  const fields = configSchema.safeParse(door.config).data?.fields ?? [];
  const s = crmDoorSubmissions;
  // JS dates carry milliseconds, Postgres microseconds: page on the truncated value.
  const ms = sql`date_trunc('milliseconds', ${s.createdAt})`;
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        id: s.id,
        createdAt: s.createdAt,
        contactId: crmContacts.id,
        contactName: crmContacts.displayName,
        consent: s.consent,
        payload: s.payload,
        attribution: s.attribution,
      })
      .from(s)
      .leftJoin(
        crmContacts,
        and(
          eq(crmContacts.id, s.contactId),
          eq(crmContacts.orgId, s.orgId),
          sql`${crmContacts.deletedAt} is null`,
        ),
      )
      .where(
        and(
          eq(s.orgId, ctx.tenantId),
          eq(s.doorId, door.id),
          cur ? sql`(${ms}, ${s.id}) < (${cur[1]}::timestamptz, ${cur[2]}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(ms), desc(s.id))
      .limit(limit + 1),
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => {
      const values = (r.payload ?? {}) as Record<string, unknown>;
      const a = (r.attribution ?? {}) as Partial<Attribution>;
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        // Null when the contact was erased (or the submission had no phone/email).
        contactId: r.contactId,
        contactName: r.contactName ?? null,
        consent: r.consent,
        values: opts.mask ? maskSubmissionValues(fields, values) : values,
        attribution: {
          utm_source: a.utm_source,
          utm_medium: a.utm_medium,
          utm_campaign: a.utm_campaign,
          referrer_host: a.referrer_host,
        },
      };
    }),
    nextCursor: rows.length > limit && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  };
}
