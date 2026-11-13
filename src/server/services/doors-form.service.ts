import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmDoorSubmissions } from '$server/db/pg-doors-schema';
import { crmContacts } from '$server/db/pg-crm-schema';
import { attachmentFileState } from '$server/db/pg-attachments-schema';
import { files } from '@minion-stack/db/pg';
import { invalidateTags, tags } from '@minion-stack/cache';
import { newId } from '$server/db/utils';
import { getStorage } from '$server/storage/blob';
import { ATTACHMENT_LIMITS, validateAttachment, assertOrgQuota } from './file.service';
import { bustCrmList } from './crm-contacts.service';
import { ensureCrmContact } from './crm-contact-ensure';
import { bumpDoorStat, resolvePublicDoor } from './doors.service';
import { upsertNotification } from './inbox/inbox.service';
import {
  configSchema,
  contactFromValues,
  fileIdsFromValues,
  FORM_IMAGE_TYPES,
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

  const fileIds = fileIdsFromValues(config.fields, checked.values);
  const tagIds = config.tagIds ?? [];
  const submissionId = randomUUID();
  const outcome = await withOrgCore(ctx, async (tx) => {
    // DNI is the strongest identity: a returning patient with a new phone is still the same contact.
    const byDni =
      profile.dni && !simulated
        ? await contactIdByDni(tx, ctx.tenantId, profile.dni, who.name)
        : null;
    const contact = byDni
      ? { id: byDni, created: false }
      : await ensureCrmContact(tx, ctx.tenantId, {
          ...who,
          source: `door:${door.slug}`,
          firstTouch: attribution,
        });
    // A new contact gets the DNI and handles. An existing one only gets handles it lacks: a DNI
    // written onto a matched contact would become a trusted match key (it stays in the payload).
    const { dni: _dni, ...handles } = profile;
    const fill = contact?.created ? profile : handles;
    if (contact && Object.keys(fill).length)
      await fillContactProfile(tx, ctx.tenantId, contact.id, fill);
    if (contact && tagIds.length) await tagContact(tx, ctx.tenantId, contact.id, tagIds);
    if (fileIds.length) {
      // Files hang off the contact (its Attachments tab). No contact, or an id that is not a
      // fresh upload of this org's doors: reject, and the throw rolls the new contact back.
      const linked = contact ? await claimDoorFiles(tx, ctx.tenantId, contact.id, fileIds) : [];
      if (linked.length !== fileIds.length) throw new UnclaimedFiles(linked);
    }
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
    return { contactId: contact?.id ?? null };
  }).catch((e) => {
    if (!(e instanceof UnclaimedFiles)) throw e;
    const ok = new Set(e.linked);
    const bad = (key: string) =>
      ((checked.values[key] as string[] | undefined) ?? []).some((id) => !ok.has(id));
    return {
      errors: Object.fromEntries(
        config.fields
          .filter((f) => f.type === 'file' && bad(f.key))
          .map((f) => [f.key, 'invalid' as const]),
      ),
    };
  });
  if ('errors' in outcome) return { status: 'invalid', errors: outcome.errors };
  if (outcome.contactId && (tagIds.length || fileIds.length)) {
    // Fail-soft: the rows are committed; a stale list heals on its own TTL.
    await Promise.all([
      tagIds.length ? bustCrmList(ctx.tenantId) : null,
      fileIds.length ? invalidateTags(tags.tenantDomain(ctx.tenantId, 'files')) : null,
    ]).catch(() => {});
  }
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

/**
 * Live contact whose DNI is `dni`. A trusted DNI (the linked party's document, or a contact
 * that did not come from a public door) matches on its own. A DNI typed into an earlier door
 * submission matches only when the name agrees too, so a stranger needs the DNI AND the name
 * to attach a submission to someone, no weaker than the phone match bookings already use.
 * Trusted first, then oldest.
 * TODO(handoff): reconcileParties mints parties from custom_fields->>'dni' without checking
 * source, so a door-created contact's DNI can become a party document after a reconcile run.
 * Pointer: proposals/2026-11-11-hub-door-dni-trust.md.
 */
async function contactIdByDni(
  tx: CoreTx,
  orgId: string,
  dni: string,
  name: string | null,
): Promise<string | null> {
  // shortcut: unindexed custom_fields scan, fine at clinic scale; add an expression index if one org passes ~50k contacts.
  const rows = (await tx.execute(sql`
    select c.id, c.display_name as name,
           (coalesce(upper(p.doc_number) = ${dni}, false)
            or coalesce(c.source, '') not like 'door:%') as trusted
    from crm_contacts c
    left join parties p on p.id = c.party_id and p.org_id = c.org_id
    where c.org_id = ${orgId} and c.deleted_at is null
      and (upper(p.doc_number) = ${dni}
           or upper(coalesce(c.custom_fields->>'dni', c.custom_fields->>'DNI')) = ${dni})
    order by trusted desc, c.created_at
    limit 20
  `)) as unknown as Array<{ id: string; name: string | null; trusted: boolean }>;
  const hit = rows.find((r) => r.trusted) ?? rows.find((r) => sameName(r.name, name));
  return hit?.id ?? null;
}

const nameTokens = (s: string | null) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1);

/** 'Ana Prueba' ~ 'ANA MARÍA PRUEBA GÓMEZ': at least two shared words, so a first name alone never matches. */
export function sameName(a: string | null, b: string | null): boolean {
  const x = nameTokens(a);
  const y = new Set(nameTokens(b));
  return x.filter((t) => y.has(t)).length >= 2;
}

/** Adds DNI / social handles to a contact; keys already on the row win. */
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

class UnclaimedFiles extends Error {
  constructor(public linked: string[]) {
    super('unclaimed door files');
  }
}

/** Puts the door's configured tags on the contact. Ids that are not manual customer tags of this org are skipped. */
async function tagContact(
  tx: CoreTx,
  orgId: string,
  contactId: string,
  tagIds: string[],
): Promise<void> {
  await tx.execute(sql`
    insert into crm_contact_tags (org_id, contact_id, tag_id, applied_by)
    select ${orgId}, ${contactId}::uuid, t.id, null
    from crm_tags t
    where t.org_id = ${orgId} and t.scope = 'crm' and t.kind = 'manual'
      and t.id in (${sql.join(
        tagIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    on conflict do nothing
  `);
}

/**
 * Links door uploads to the contact and returns the ids it linked. Only a file `uploadDoorFile`
 * stored (no uploader, CRM-only, never linked) and younger than the abandoned-upload sweep
 * qualifies, so a submission cannot attach a file that belongs to anything else.
 */
async function claimDoorFiles(
  tx: CoreTx,
  orgId: string,
  contactId: string,
  fileIds: string[],
): Promise<string[]> {
  const rows = (await tx.execute(sql`
    with claimed as (
      select f.id
      from files f
      join attachment_file_state s on s.file_id = f.id and s.org_id = ${orgId}
      where f.tenant_id = ${orgId}::uuid
        and f.id in (${sql.join(
          fileIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        and f.uploaded_by is null and f.category = 'attachment'
        and f.created_at > now() - interval '23 hours'
        and s.state = 'active' and s.access_modules = array['crm']
        and not exists (select 1 from attachment_links l where l.file_id = f.id)
        and not exists (select 1 from attachment_trash t where t.file_id = f.id)
      for update of f
    )
    insert into attachment_links (org_id, file_id, object_type, object_id, linked_by)
    select ${orgId}, id, 'crm_contact', ${contactId}::uuid, null from claimed
    on conflict do nothing
    returning file_id
  `)) as unknown as Array<{ file_id: string }>;
  return rows.map((r) => r.file_id);
}

export type UploadDoorFileResult =
  | { status: 'ok'; fileId: string }
  | {
      status: 'not_found' | 'invalid_field' | 'mime_not_allowed' | 'too_large' | 'quota_exceeded';
    };

/**
 * Stores one file a visitor attached to a `file` field, before they submit. The file stays
 * unlinked (invisible to staff) until a submission claims it; the attachment sweeper deletes
 * it after 24 h otherwise. Nothing here logs the file name or content.
 * shortcut: server-proxied, so capped at ATTACHMENT_LIMITS.proxiedMaxBytes (4 MB); add a
 * presigned intent when doors need bigger files (the bucket must then allow the page's origin).
 */
export async function uploadDoorFile(
  slug: string,
  input: { field: string; fileName: string; contentType: string; data: Uint8Array },
): Promise<UploadDoorFileResult> {
  const resolved = await resolvePublicDoor(slug);
  if (!resolved || resolved.door.kind !== 'form') return { status: 'not_found' };
  const { ctx, door } = resolved;
  const field = configSchema
    .parse(door.config)
    .fields.find((f) => f.key === input.field && f.type === 'file');
  if (!field) return { status: 'invalid_field' };

  const contentType = input.contentType.split(';')[0].trim().toLowerCase();
  if (field.accept === 'image' && !FORM_IMAGE_TYPES.includes(contentType))
    return { status: 'mime_not_allowed' };
  // The name becomes part of the storage key: keep letters, digits and a few separators.
  const fileName =
    input.fileName
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
      .slice(-120) || 'archivo';
  const sizeBytes = input.data.byteLength;
  const valid = validateAttachment(
    { fileName, contentType, sizeBytes },
    { maxBytes: ATTACHMENT_LIMITS.proxiedMaxBytes },
  );
  if (!valid.ok) return { status: valid.code };
  if (!sizeBytes) return { status: 'invalid_field' };
  const quota = await assertOrgQuota(ctx, sizeBytes);
  if (!quota.ok) return { status: 'quota_exceeded' };

  const id = newId();
  const key = `${ctx.tenantId}/attachments/${id}/${fileName}`;
  // Row first, like uploadProxiedAttachment: a failed PUT leaves a reservation the sweeper reaps.
  await withOrgCore(ctx, async (tx) => {
    await tx.insert(files).values({
      id,
      tenantId: ctx.tenantId,
      uploadedBy: null,
      b2FileKey: key,
      fileName,
      contentType,
      sizeBytes,
      category: 'attachment',
    });
    await tx
      .insert(attachmentFileState)
      .values({ fileId: id, orgId: ctx.tenantId, fileKey: key, accessModules: ['crm'] });
  });
  await getStorage().put(key, input.data, contentType);
  return { status: 'ok', fileId: id };
}

/** Field types whose values are never personal (option labels, yes/no, file ids). */
const SAFE_TYPES = new Set(['select', 'checkbox', 'multiselect', 'file']);

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
