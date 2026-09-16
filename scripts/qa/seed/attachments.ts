/**
 * Attachments — files (@minion-stack/db/pg), polymorphic links, trash,
 * per-file lifecycle state. B2 is never configured for the QA stack (spec
 * §8 out-of-scope): rows exist and render, but a download attempt fails —
 * that's by design, not a bug to fix here.
 */
import { matrixTextId, matrixUuid } from './ids';
import { ORG_BUSINESS, userId } from './tenancy';
import { CONTACT_DNI_VERIFIED } from './crm';
import type { SeedContext } from './db';

const ORG_QUOTA_BYTES = Number(process.env.ATTACHMENT_ORG_QUOTA_BYTES) || 2 * 1024 * 1024 * 1024;

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register, now } = ctx;
  const owner = userId('tenancy.user.owner');

  const fileLinked3 = matrixTextId('att.file.linked-3-objects');
  const fileTrashed = matrixTextId('att.link.trashed');
  const fileDeleting = matrixTextId('att.file.deleting-tombstone');
  const fileNearQuota = matrixTextId('att.file.near-quota');

  // `files` carries a BEFORE INSERT trigger (guard_managed_file_identity) that
  // raises "managed attachment key cannot be reused" whenever an
  // attachment_file_state row already references the candidate id/key — and
  // Postgres fires BEFORE ROW triggers for the attempted row before an
  // ON CONFLICT clause (DO UPDATE *or* DO NOTHING) gets to suppress it. So a
  // plain `on conflict do update/nothing` is NOT idempotent here once
  // att.file.deleting-tombstone's attachment_file_state row exists — guard
  // with an application-level `where not exists` instead, which never
  // produces a candidate row for Postgres to fire the trigger on.
  const files: Array<{ id: string; key: string; name: string; contentType: string; size: number }> =
    [
      {
        id: fileLinked3,
        key: `qa/${fileLinked3}.pdf`,
        name: 'qa-linked-3-objects.pdf',
        contentType: 'application/pdf',
        size: 45000,
      },
      {
        id: fileTrashed,
        key: `qa/${fileTrashed}.pdf`,
        name: 'qa-trashed.pdf',
        contentType: 'application/pdf',
        size: 12000,
      },
      {
        id: fileDeleting,
        key: `qa/${fileDeleting}.pdf`,
        name: 'qa-deleting.pdf',
        contentType: 'application/pdf',
        size: 8000,
      },
      {
        id: fileNearQuota,
        key: `qa/${fileNearQuota}.zip`,
        name: 'qa-near-quota.zip',
        contentType: 'application/zip',
        size: ORG_QUOTA_BYTES - 1024,
      },
    ];
  for (const f of files) {
    await sql`
      insert into files (id, tenant_id, uploaded_by, b2_file_key, file_name, content_type, size_bytes, category)
      select ${f.id}, ${ORG_BUSINESS}, ${owner}, ${f.key}, ${f.name}, ${f.contentType}, ${f.size}, 'general'
      where not exists (select 1 from files where id = ${f.id})
    `;
  }
  register('att.file.near-quota', { table: 'files', where: { id: fileNearQuota } });

  const invoiceId = matrixUuid('fin.invoice.susii-paid'); // finances.ts owns the row; soft ref (no FK).
  const bookingId = matrixUuid('sched.booking.accepted'); // scheduling.ts owns the row; soft ref (no FK).
  await sql`
    insert into attachment_links (org_id, file_id, object_type, object_id, linked_by)
    values
      (${ORG_BUSINESS}, ${fileLinked3}, 'crm_contact', ${CONTACT_DNI_VERIFIED}, ${owner}),
      (${ORG_BUSINESS}, ${fileLinked3}, 'booking', ${bookingId}, ${owner}),
      (${ORG_BUSINESS}, ${fileLinked3}, 'fin_invoice', ${invoiceId}, ${owner})
    on conflict (object_type, object_id, file_id) do nothing
  `;
  register('att.file.linked-3-objects', {
    table: 'attachment_links',
    where: {
      org_id: ORG_BUSINESS,
      file_id: fileLinked3,
      object_type: 'crm_contact',
      object_id: CONTACT_DNI_VERIFIED,
    },
  });

  const orphanObjectId = matrixUuid('att.link.orphan-object', 'nonexistent-contact');
  await sql`
    insert into attachment_links (org_id, file_id, object_type, object_id, linked_by)
    values (${ORG_BUSINESS}, ${fileNearQuota}, 'crm_contact', ${orphanObjectId}, ${owner})
    on conflict (object_type, object_id, file_id) do nothing
  `;
  register('att.link.orphan-object', {
    table: 'attachment_links',
    where: {
      org_id: ORG_BUSINESS,
      file_id: fileNearQuota,
      object_type: 'crm_contact',
      object_id: orphanObjectId,
    },
  });

  // Trashed: exists ONLY in attachment_trash, no live attachment_links row.
  await sql`
    insert into attachment_trash (org_id, file_id, object_type, object_id, linked_by, linked_at, hidden_by, hidden_at)
    values (${ORG_BUSINESS}, ${fileTrashed}, 'crm_contact', ${CONTACT_DNI_VERIFIED}, ${owner}, ${now.toISOString()}, ${owner}, ${now.toISOString()})
    on conflict (object_type, object_id, file_id) do nothing
  `;
  register('att.link.trashed', {
    table: 'attachment_trash',
    where: {
      org_id: ORG_BUSINESS,
      file_id: fileTrashed,
      object_type: 'crm_contact',
      object_id: CONTACT_DNI_VERIFIED,
    },
  });

  await sql`
    insert into attachment_file_state (file_id, org_id, file_key, state, delete_requested_by, delete_requested_at)
    values (${fileDeleting}, ${ORG_BUSINESS}, ${`qa/${fileDeleting}.pdf`}, 'deleting', ${owner}, ${now.toISOString()})
    on conflict (file_id) do update set state = excluded.state
  `;
  register('att.file.deleting-tombstone', {
    table: 'attachment_file_state',
    where: { file_id: fileDeleting },
  });
}
