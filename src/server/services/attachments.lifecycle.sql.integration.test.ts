import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { sql } from 'drizzle-orm';
const store = vi.hoisted(() => ({
  presignPut: vi.fn(async () => 'https://fixture.invalid/put'),
  head: vi.fn<() => Promise<{ size: number; contentType: string } | null>>(),
  delete: vi.fn<(key: string) => Promise<void>>(),
  getSignedUrl: vi.fn(async () => 'https://fixture.invalid/read'),
}));
vi.mock('$server/storage/blob', () => ({ getStorage: () => store }));
vi.mock('$server/services/rbac.service', () => ({
  hasOrgCapability: vi.fn(),
  ownerFilter: vi.fn(),
}));
import { withOrgCore } from '$server/db/with-org-core';
import {
  createUploadIntent,
  linkAttachment,
  unlinkAttachment,
  deleteAttachment,
  getAttachmentDownloadUrl,
  finalizeUpload,
  sweepAbandonedUploads,
  restoreAttachmentLink,
  listTrashedAttachmentsFor,
} from './attachments.service';
import { detachObjectAttachmentsInTx } from './attachment-lifecycle';
import {
  openAttachmentFixture,
  access,
  ORG,
  OTHER_ORG,
  USER,
  CONTACT,
  BOOKING,
  migrationSource,
  barrier,
  waitForDatabaseLock,
} from '$server/test-utils/attachment-postgres-fixture';
let f: Awaited<ReturnType<typeof openAttachmentFixture>>;
let b: ReturnType<Awaited<ReturnType<typeof openAttachmentFixture>>['connection']>;
let c: typeof b;
const pending = new Set<Promise<unknown>>();
const releases = new Set<() => void>();
const run = <T>(task: Promise<T>) => {
  pending.add(task);
  void task.then(
    () => pending.delete(task),
    () => pending.delete(task),
  );
  return task;
};
const latch = () => {
  const b = barrier();
  releases.add(b.release);
  return b;
};
const ref = { objectType: 'booking' as const, objectId: BOOKING };
beforeAll(async () => {
  f = await openAttachmentFixture();
  b = f.connection();
  c = f.connection();
  console.info('attachment lifecycle native receipt', f.receipt);
});
beforeEach(async () => {
  await f.reset();
  vi.clearAllMocks();
  store.head.mockResolvedValue({ size: 42, contentType: 'application/pdf' });
  store.delete.mockResolvedValue();
});
afterEach(async () => {
  for (const release of releases) release();
  releases.clear();
  await Promise.allSettled([...pending]);
});
afterAll(async () => {
  await f?.close();
});
async function blocked(client: typeof f.client) {
  const [{ pid }] = await client`SELECT pg_backend_pid() AS pid`;
  return pid as number;
}
async function counts() {
  const [r] =
    await f.owner`SELECT (select count(*)::int from files) AS files,(select count(*)::int from attachment_links) AS links,(select count(*)::int from attachment_file_state) AS states`;
  return r;
}
describe('native attachment deletion lifecycle', () => {
  it('rolls back failed claim admission before any object-store effect', async () => {
    await f.seedFile();
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await f.owner.unsafe(
      `CREATE FUNCTION fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture claim fault'; END $$; CREATE TRIGGER fixture_claim_fault BEFORE UPDATE ON attachment_file_state FOR EACH ROW EXECUTE FUNCTION fail_claim()`,
    );
    try {
      await expect(deleteAttachment(f.ctx, 'file-a', access(), { force: true })).rejects.toThrow();
      expect(store.delete).not.toHaveBeenCalled();
      expect(await counts()).toEqual({ files: 1, links: 1, states: 1 });
    } finally {
      await f.owner.unsafe(
        'DROP TRIGGER fixture_claim_fault ON attachment_file_state; DROP FUNCTION fail_claim()',
      );
    }
  });
  it('storage failure keeps a tombstone, blocks relink/read, and a new sweep resumes the same claim', async () => {
    await f.seedFile();
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    store.delete.mockRejectedValueOnce(new Error('fixture storage unavailable'));
    await expect(deleteAttachment(f.ctx, 'file-a', access(), { force: true })).rejects.toThrow(
      'fixture storage unavailable',
    );
    expect(await counts()).toEqual({ files: 1, links: 0, states: 1 });
    await expect(
      linkAttachment(b.ctx, { fileId: 'file-a', ...ref }, access()),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(getAttachmentDownloadUrl(b.ctx, 'file-a', access())).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await sweepAbandonedUploads(b.ctx)).deleted).toBe(1);
    expect(await counts()).toEqual({ files: 0, links: 0, states: 0 });
    expect(store.delete).toHaveBeenCalledTimes(2);
  });
  it('database cleanup failure after blob deletion retries without resurrecting the file or repeating physical deletion', async () => {
    const key = await f.seedFile();
    const objects = new Set([key]);
    let removed = 0;
    store.delete.mockImplementation(async (k) => {
      if (objects.delete(k)) removed++;
    });
    await f.owner.unsafe(
      `CREATE FUNCTION fail_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture cleanup fault'; END $$; CREATE TRIGGER fixture_cleanup_fault BEFORE DELETE ON files FOR EACH ROW EXECUTE FUNCTION fail_cleanup()`,
    );
    try {
      await expect(deleteAttachment(f.ctx, 'file-a', access())).rejects.toThrow();
      expect(removed).toBe(1);
      expect(await counts()).toEqual({ files: 1, links: 0, states: 1 });
    } finally {
      await f.owner.unsafe(
        'DROP TRIGGER fixture_cleanup_fault ON files; DROP FUNCTION fail_cleanup()',
      );
    }
    await deleteAttachment(b.ctx, 'file-a', access());
    expect(removed).toBe(1);
    expect(await counts()).toEqual({ files: 0, links: 0, states: 0 });
  });
  it('rejects reactivation and immutable key/tenant mutation on a pending claim', async () => {
    await f.seedFile();
    store.delete.mockRejectedValueOnce(new Error('fixture pending'));
    await expect(deleteAttachment(f.ctx, 'file-a', access())).rejects.toThrow();
    for (const change of [
      "state='active',delete_requested_at=NULL",
      "file_key='other'",
      "org_id='other'",
    ])
      await expect(
        f.owner.unsafe(`UPDATE attachment_file_state SET ${change} WHERE file_id='file-a'`),
      ).rejects.toThrow();
  });
  it('failed claims rotate behind untouched work even when the sweep limit is one', async () => {
    await f.seedFile('failed', { old: true });
    await f.seedFile('next', { old: true });
    store.head.mockRejectedValueOnce(new Error('fixture HEAD unavailable'));
    const first = await sweepAbandonedUploads(f.ctx, { limit: 1 });
    expect(first.failed).toBe(1);
    const second = await sweepAbandonedUploads(f.ctx, { limit: 1 });
    expect(second.deleted).toBe(1);
    expect(await f.owner`SELECT id FROM files`).toEqual([{ id: 'failed' }]);
    expect((await sweepAbandonedUploads(f.ctx, { limit: 1 })).deleted).toBe(1);
  });
  it('managed file keys cannot be overwritten after registration or deletion admission', async () => {
    await f.seedFile();
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    for (const change of ["b2_file_key='other'", "id='other'", `tenant_id='${OTHER_ORG}'`])
      await expect(f.owner.unsafe(`UPDATE files SET ${change} WHERE id='file-a'`)).rejects.toThrow(
        'managed attachment file identity',
      );
  });
  it('a link committed before sweeper acquires the file lock is never deleted', async () => {
    await f.seedFile('file-a', { old: true });
    const held = latch(),
      release = latch();
    const pidB = await blocked(b.client),
      pidC = await blocked(c.client);
    const blocker = run(
      withOrgCore(f.ctx, async (tx) => {
        await tx.execute(sql`SELECT id FROM files WHERE id='file-a' FOR UPDATE`);
        held.release();
        await release.promise;
      }),
    );
    await held.promise;
    const linked = run(linkAttachment(b.ctx, { fileId: 'file-a', ...ref }, access()));
    await waitForDatabaseLock(f.owner, pidB);
    const sweep = run(sweepAbandonedUploads(c.ctx));
    await waitForDatabaseLock(f.owner, pidC);
    release.release();
    await blocker;
    await linked;
    expect((await sweep).deleted).toBe(0);
    expect(store.delete).not.toHaveBeenCalled();
    expect((await counts()).links).toBe(1);
  });
  it('a committed sweep claim prevents a concurrent linker before storage finishes', async () => {
    await f.seedFile('file-a', { old: true });
    const entered = latch(),
      release = latch();
    store.delete.mockImplementationOnce(async () => {
      entered.release();
      await release.promise;
    });
    const sweep = run(sweepAbandonedUploads(f.ctx));
    await entered.promise;
    await expect(
      linkAttachment(b.ctx, { fileId: 'file-a', ...ref }, access()),
    ).rejects.toMatchObject({ code: 'not_found' });
    release.release();
    expect((await sweep).deleted).toBe(1);
    expect(await counts()).toEqual({ files: 0, links: 0, states: 0 });
  });
  it('concurrent retries delete one physical object and safely finish one committed claim', async () => {
    const key = await f.seedFile();
    const objects = new Set([key]);
    let removed = 0;
    const first = latch(),
      second = latch(),
      release = latch();
    let calls = 0;
    store.delete.mockImplementation(async (k) => {
      calls++;
      (calls === 1 ? first : second).release();
      await release.promise;
      if (objects.delete(k)) removed++;
    });
    const one = run(deleteAttachment(f.ctx, 'file-a', access()));
    await first.promise;
    const two = run(deleteAttachment(b.ctx, 'file-a', access()));
    await second.promise;
    release.release();
    await Promise.all([one, two]);
    expect(removed).toBe(1);
    expect(await counts()).toEqual({ files: 0, links: 0, states: 0 });
  });
  it('record deletion commits before a waiting link, which then refuses the nonexistent record', async () => {
    await f.seedFile();
    const held = latch(),
      release = latch();
    const pidB = await blocked(b.client);
    const deletion = run(
      withOrgCore(f.ctx, async (tx) => {
        await tx.execute(sql`SELECT id FROM sched_bookings WHERE id=${BOOKING} FOR UPDATE`);
        held.release();
        await release.promise;
        await detachObjectAttachmentsInTx(tx, f.ctx, ref);
        await tx.execute(sql`DELETE FROM sched_bookings WHERE id=${BOOKING}`);
      }),
    );
    await held.promise;
    const linked = run(linkAttachment(b.ctx, { fileId: 'file-a', ...ref }, access()));
    await waitForDatabaseLock(f.owner, pidB);
    release.release();
    await deletion;
    await expect(linked).rejects.toMatchObject({ code: 'not_found' });
    expect((await counts()).links).toBe(0);
  });
  it('an admitted link serializes before record deletion; helper and trigger clean it idempotently', async () => {
    await f.seedFile();
    const held = latch(),
      release = latch();
    const pidB = await blocked(b.client),
      pidC = await blocked(c.client);
    const blocker = run(
      withOrgCore(f.ctx, async (tx) => {
        await tx.execute(sql`SELECT id FROM files WHERE id='file-a' FOR UPDATE`);
        held.release();
        await release.promise;
      }),
    );
    await held.promise;
    const linked = run(linkAttachment(b.ctx, { fileId: 'file-a', ...ref }, access()));
    await waitForDatabaseLock(f.owner, pidB);
    const deletion = run(
      withOrgCore(c.ctx, async (tx) => {
        await tx.execute(sql`SELECT id FROM sched_bookings WHERE id=${BOOKING} FOR UPDATE`);
        await detachObjectAttachmentsInTx(tx, c.ctx, ref);
        await tx.execute(sql`DELETE FROM sched_bookings WHERE id=${BOOKING}`);
      }),
    );
    await waitForDatabaseLock(f.owner, pidC);
    release.release();
    await blocker;
    await linked;
    await deletion;
    expect(await counts()).toEqual({ files: 1, links: 0, states: 1 });
    expect(store.delete).not.toHaveBeenCalled();
  });
  it('CRM soft deletion cleans references while preserving durable file registration', async () => {
    await f.seedFile();
    await linkAttachment(
      f.ctx,
      { fileId: 'file-a', objectType: 'crm_contact', objectId: CONTACT },
      access(),
    );
    await withOrgCore(f.ctx, (tx) =>
      tx.execute(sql`UPDATE crm_contacts SET deleted_at=now() WHERE id=${CONTACT}`),
    );
    expect(await counts()).toEqual({ files: 1, links: 0, states: 1 });
  });
  const recordTables = {
    crm_contact: 'crm_contacts',
    booking: 'sched_bookings',
    event_type: 'sched_event_types',
    product: 'fin_products',
    stk_item: 'stk_items',
    stk_entry: 'stk_entries',
    fin_invoice: 'fin_invoices',
    pos_ticket: 'pos_tickets',
  } as const;
  it.each(Object.keys(recordTables) as (keyof typeof recordTables)[])(
    'actual %s DELETE trigger detaches only its tenant references with no storage effect',
    async (objectType) => {
      const target = await f.seedRecord(objectType),
        foreign = await f.seedRecord(objectType, OTHER_ORG);
      await f.seedFile();
      await f.seedFile('other-file', { tenantId: OTHER_ORG });
      await linkAttachment(f.ctx, { fileId: 'file-a', ...target }, access());
      await f.owner`INSERT INTO attachment_links(org_id,file_id,object_type,object_id) VALUES (${OTHER_ORG},'other-file',${objectType},${foreign.objectId})`;
      await withOrgCore(f.ctx, (tx) =>
        tx.execute(
          sql.raw(`DELETE FROM ${recordTables[objectType]} WHERE id='${foreign.objectId}'`),
        ),
      );
      expect(await f.owner`SELECT * FROM attachment_links`).toHaveLength(2);
      await withOrgCore(f.ctx, (tx) =>
        tx.execute(
          sql.raw(`DELETE FROM ${recordTables[objectType]} WHERE id='${target.objectId}'`),
        ),
      );
      expect(await f.owner`SELECT * FROM attachment_links`).toMatchObject([
        { org_id: OTHER_ORG, file_id: 'other-file' },
      ]);
      expect(await f.owner`SELECT * FROM attachment_file_state WHERE org_id=${ORG}`).toMatchObject([
        { org_id: ORG, file_id: 'file-a' },
      ]);
      expect(
        await f.owner`SELECT * FROM attachment_file_state WHERE org_id=${OTHER_ORG}`,
      ).toMatchObject([{ file_id: 'other-file', access_modules: ['crm'] }]);
      expect(store.delete).not.toHaveBeenCalled();
    },
  );
  it('unlink A then delete B retains both historical modules and refuses module removal', async () => {
    await f.seedFile('file-a', { category: 'general', key: `${ORG}/general/file-a/data` });
    const crm = { objectType: 'crm_contact' as const, objectId: CONTACT };
    await linkAttachment(f.ctx, { fileId: 'file-a', ...crm }, access());
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await unlinkAttachment(f.ctx, { fileId: 'file-a', ...crm }, access());
    await withOrgCore(f.ctx, (tx) =>
      tx.execute(sql`DELETE FROM sched_bookings WHERE id=${BOOKING}`),
    );
    const [state] =
      await f.owner`SELECT access_modules FROM attachment_file_state WHERE file_id='file-a'`;
    expect([...state.access_modules].sort()).toEqual(['crm', 'scheduling']);
    await expect(
      f.owner`UPDATE attachment_file_state SET access_modules=ARRAY['scheduling'] WHERE file_id='file-a'`,
    ).rejects.toThrow('immutable');
  });
  it('owner maintenance cleanup preserves cross-tenant predicates and the captured append-only audit ACL', async () => {
    await f.seedFile();
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await expect(
      withOrgCore(f.ctx, (tx) => tx.execute(sql`DELETE FROM doc_audit_log`)),
    ).rejects.toThrow();
    await expect(
      withOrgCore(f.ctx, (tx) => tx.execute(sql`UPDATE doc_audit_log SET op='forged'`)),
    ).rejects.toThrow();
    await f.owner`DELETE FROM sched_bookings WHERE id=${BOOKING}`;
    expect(await counts()).toEqual({ files: 1, links: 0, states: 1 });
    expect(store.delete).not.toHaveBeenCalled();
  });
  it('a stale finalize HEAD cannot recreate a file after deletion', async () => {
    await f.seedFile();
    const entered = latch(),
      release = latch();
    store.head.mockImplementationOnce(async () => {
      entered.release();
      await release.promise;
      return { size: 42, contentType: 'application/pdf' };
    });
    const finalize = run(finalizeUpload(f.ctx, { fileId: 'file-a', links: [ref] }, access()));
    await entered.promise;
    await deleteAttachment(b.ctx, 'file-a', access());
    release.release();
    await expect(finalize).rejects.toMatchObject({ code: 'not_found' });
    expect(await counts()).toEqual({ files: 0, links: 0, states: 0 });
  });
  it('defers live signed uploads and reconciles a late PUT after first deletion without forgetting the key', async () => {
    const upload = await createUploadIntent(
      f.ctx,
      { fileName: 'late.pdf', contentType: 'application/pdf', sizeBytes: 42, links: [ref] },
      access(),
    );
    const objects = new Set([upload.key]);
    let effects = 0;
    store.head.mockImplementation(async () =>
      objects.has(upload.key) ? { size: 42, contentType: 'application/pdf' } : null,
    );
    store.delete.mockImplementation(async (key) => {
      if (objects.delete(key)) effects++;
    });
    await deleteAttachment(f.ctx, upload.fileId, access());
    expect(effects).toBe(0);
    expect((await counts()).files).toBe(1);
    await expect(getAttachmentDownloadUrl(f.ctx, upload.fileId, access())).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await sweepAbandonedUploads(f.ctx)).scanned).toBe(0);
    await f.owner`UPDATE attachment_file_state SET upload_expires_at=now()-interval '1 second' WHERE file_id=${upload.fileId}`;
    expect((await sweepAbandonedUploads(f.ctx)).deleted).toBe(1);
    expect(effects).toBe(1);
    expect(await counts()).toEqual({ files: 0, links: 0, states: 1 });
    await expect(
      f.owner`INSERT INTO files(id,tenant_id,uploaded_by,b2_file_key,file_name,content_type,size_bytes) VALUES (${upload.fileId},${ORG},${USER},${upload.key},'reused.pdf','application/pdf',42)`,
    ).rejects.toThrow('cannot be reused');
    objects.add(upload.key); // A PUT accepted before expiry finishes after deletion.
    expect((await sweepAbandonedUploads(f.ctx)).scanned).toBe(0);
    await f.owner`UPDATE attachment_file_state SET delete_attempted_at=now()-interval '2 hours',delete_reconciled_at=now()-interval '2 hours' WHERE file_id=${upload.fileId}`;
    const reconciliation = await sweepAbandonedUploads(b.ctx);
    expect(reconciliation).toMatchObject({ deleted: 0, storageObjectsDeleted: 1, failed: 0 });
    expect(effects).toBe(2);
    expect(await counts()).toEqual({ files: 0, links: 0, states: 1 });
    await expect(
      linkAttachment(b.ctx, { fileId: upload.fileId, ...ref }, access()),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('migration backfill is idempotent and refuses cross-tenant legacy references', async () => {
    await f.seedFile('file-a', { registered: false });
    const migration = migrationSource('20260913020000_attachment_file_state.sql')
      .replaceAll('public.', `"${f.schema}".`)
      .replaceAll("schemaname='public'", `schemaname='${f.schema}'`);
    await f.owner.unsafe(migration);
    await f.owner.unsafe(migration);
    expect((await counts()).states).toBe(1);
    await f.owner`INSERT INTO attachment_links(org_id,file_id,object_type,object_id) VALUES ('other','file-a','booking',${BOOKING})`;
    await expect(f.owner.unsafe(migration)).rejects.toThrow(
      'attachment links require tenant/file reconciliation',
    );
    // The replay CREATE OR REPLACEd the record-deletion trigger function back to
    // this migration's body; re-apply the later (idempotent) migration so the
    // schema is whole again for the tests that follow.
    await f.owner.unsafe(
      migrationSource('20260913030000_attachment_trash.sql')
        .replaceAll('public.', `"${f.schema}".`)
        .replaceAll("schemaname='public'", `schemaname='${f.schema}'`),
    );
  });
});

describe('native two-layer deletion (trash, then claim)', () => {
  const trash = async () =>
    f.owner`SELECT file_id,object_type,object_id,hidden_by FROM attachment_trash ORDER BY hidden_at`;
  it('unlink hides the link in the trash and restore moves it back with its original link identity', async () => {
    await f.seedFile();
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    const [before] = await f.owner`SELECT linked_by,linked_at FROM attachment_links`;
    await unlinkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    expect(await counts()).toEqual({ files: 1, links: 0, states: 1 });
    expect(await trash()).toMatchObject([
      { file_id: 'file-a', object_type: 'booking', object_id: BOOKING, hidden_by: USER },
    ]);
    const listed = await listTrashedAttachmentsFor(f.ctx, 'booking', BOOKING, access());
    expect(listed.map((row) => row.file.id)).toEqual(['file-a']);
    await restoreAttachmentLink(f.ctx, { fileId: 'file-a', ...ref }, access());
    expect(await counts()).toEqual({ files: 1, links: 1, states: 1 });
    expect(await trash()).toHaveLength(0);
    const [after] = await f.owner`SELECT linked_by,linked_at FROM attachment_links`;
    expect(after).toEqual(before);
    expect(store.delete).not.toHaveBeenCalled();
  });
  it('a plain relink of a trashed file clears its trash row; restoring a link that is not trashed is refused', async () => {
    await f.seedFile();
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await unlinkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    expect(await trash()).toHaveLength(0);
    await expect(
      restoreAttachmentLink(f.ctx, { fileId: 'file-a', ...ref }, access()),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('the record DELETE trigger hides links as system-trashed rows that cannot be restored to the missing record', async () => {
    await f.seedFile();
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await withOrgCore(f.ctx, (tx) =>
      tx.execute(sql`DELETE FROM sched_bookings WHERE id=${BOOKING}`),
    );
    expect(await counts()).toEqual({ files: 1, links: 0, states: 1 });
    expect(await trash()).toMatchObject([{ file_id: 'file-a', hidden_by: null }]);
    await expect(
      restoreAttachmentLink(f.ctx, { fileId: 'file-a', ...ref }, access()),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(store.delete).not.toHaveBeenCalled();
  });
  it('the sweeper leaves a trashed file alone inside the retention window and claims it after', async () => {
    await f.seedFile('file-a', { old: true });
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await unlinkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    expect(await sweepAbandonedUploads(f.ctx)).toMatchObject({ scanned: 0, deleted: 0 });
    expect(await counts()).toEqual({ files: 1, links: 0, states: 1 });
    await f.owner`UPDATE attachment_trash SET hidden_at=now()-interval '31 days'`;
    expect(await sweepAbandonedUploads(f.ctx)).toMatchObject({ scanned: 1, deleted: 1, failed: 0 });
    expect(store.delete).toHaveBeenCalledTimes(1);
    expect(await counts()).toEqual({ files: 0, links: 0, states: 0 });
    expect(await trash()).toHaveLength(0);
  });
  it('re-hiding a restored link restarts its retention clock', async () => {
    await f.seedFile('file-a', { old: true });
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await unlinkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await f.owner`UPDATE attachment_trash SET hidden_at=now()-interval '31 days'`;
    await restoreAttachmentLink(f.ctx, { fileId: 'file-a', ...ref }, access());
    await unlinkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    expect(await sweepAbandonedUploads(f.ctx)).toMatchObject({ scanned: 0, deleted: 0 });
    expect(await counts()).toEqual({ files: 1, links: 0, states: 1 });
  });
});
