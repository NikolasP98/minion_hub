<script lang="ts">
  import { FileText, FileSpreadsheet, Image, Music, Paperclip, Video } from 'lucide-svelte';
  import { Button, Chip, Popover, Select, iconSizes } from '$lib/components/ui';
  import { ConfirmDialog } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { formatBytes, fmtTimeAgo } from '$lib/utils/format';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import {
    attachmentDownloadUrl,
    deleteAttachment,
    linkAttachment,
    listAttachments,
    unlinkAttachment,
    type AttachmentObjectRef,
    type AttachmentObjectType,
    type AttachmentWithLinks,
  } from '$lib/attachments/upload';

  interface Props {
    objectType: AttachmentObjectType;
    objectId: string;
    /** Bump to refetch (e.g. after `AttachmentButton`'s `onuploaded`). */
    refreshKey?: number;
    compact?: boolean;
  }

  let { objectType, objectId, refreshKey = 0, compact = false }: Props = $props();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // TODO(handoff): "Link to…" takes a raw object id — a Picker per object
  // type (contacts, bookings, services…) is a later slice; this form is the
  // interim, validated only as a well-formed uuid.
  const OBJECT_TYPE_LABEL: Record<AttachmentObjectType, () => string> = {
    crm_contact: m.attachments_object_crm_contact,
    booking: m.attachments_object_booking,
    event_type: m.attachments_object_event_type,
    product: m.attachments_object_product,
    stk_item: m.attachments_object_stk_item,
    fin_invoice: m.attachments_object_fin_invoice,
    stk_entry: m.attachments_object_stk_entry,
    pos_ticket: m.attachments_object_pos_ticket,
  };
  const OBJECT_TYPE_OPTIONS = Object.keys(OBJECT_TYPE_LABEL).map((value) => ({
    value,
    label: OBJECT_TYPE_LABEL[value as AttachmentObjectType](),
  }));

  function iconFor(contentType: string) {
    if (contentType.startsWith('image/')) return Image;
    if (contentType.startsWith('audio/')) return Music;
    if (contentType.startsWith('video/')) return Video;
    if (contentType.includes('sheet') || contentType.includes('excel')) return FileSpreadsheet;
    if (contentType === 'application/pdf' || contentType.includes('word')) return FileText;
    return Paperclip;
  }

  let rows = $state<AttachmentWithLinks[]>([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    try {
      rows = await listAttachments(objectType, objectId);
    } catch {
      rows = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // Track the deps this effect depends on before the first await.
    void objectType;
    void objectId;
    void refreshKey;
    load();
  });

  function otherLinks(row: AttachmentWithLinks): AttachmentObjectRef[] {
    return row.links.filter((l) => !(l.objectType === objectType && l.objectId === objectId));
  }

  let pendingDeleteFileId = $state<string | null>(null);

  async function onUnlink(row: AttachmentWithLinks) {
    const remaining = otherLinks(row);
    try {
      await unlinkAttachment(row.file.id, { objectType, objectId });
    } catch {
      toastError(m.attachments_unlink_failed());
      return;
    }
    if (remaining.length === 0) {
      pendingDeleteFileId = row.file.id;
    } else {
      await load();
    }
  }

  async function confirmDelete() {
    if (!pendingDeleteFileId) return;
    await deleteAttachment(pendingDeleteFileId);
    pendingDeleteFileId = null;
    await load();
  }

  async function onOpen(fileId: string) {
    try {
      const url = await attachmentDownloadUrl(fileId);
      window.open(url, '_blank', 'noopener');
    } catch {
      toastError(m.attachments_open_failed());
    }
  }

  let linkTypeByFile = $state<Record<string, AttachmentObjectType>>({});
  let linkIdByFile = $state<Record<string, string>>({});
  let linkOpenFile = $state<string | null>(null);
  let linkBusy = $state(false);

  async function submitLink(fileId: string) {
    const type = linkTypeByFile[fileId] ?? OBJECT_TYPE_OPTIONS[0].value;
    const id = (linkIdByFile[fileId] ?? '').trim();
    if (!UUID_RE.test(id)) {
      toastError(m.attachments_link_invalid_id());
      return;
    }
    linkBusy = true;
    try {
      await linkAttachment(fileId, { objectType: type as AttachmentObjectType, objectId: id });
      linkOpenFile = null;
      linkIdByFile = { ...linkIdByFile, [fileId]: '' };
      await load();
    } catch {
      toastError(m.attachments_link_failed());
    } finally {
      linkBusy = false;
    }
  }
</script>

<div class="attachment-list" class:compact>
  {#if !loading && rows.length === 0}
    <p class="t-caption">{m.attachments_empty()}</p>
  {:else}
    {#each rows as row (row.file.id)}
      {@const Icon = iconFor(row.file.contentType)}
      {@const others = otherLinks(row)}
      <div class="row">
        <Icon size={iconSizes.sm} class="shrink-0 text-muted" />
        <Button variant="ghost" size="sm" class="name" onclick={() => onOpen(row.file.id)}>
          {row.file.fileName}
        </Button>
        <span class="t-caption meta">{formatBytes(row.file.sizeBytes)}</span>
        <span class="t-caption meta">{fmtTimeAgo(new Date(row.file.createdAt).getTime())}</span>
        {#if others.length > 0}
          <div class="also-linked">
            <span class="t-caption">{m.attachments_also_linked()}</span>
            {#each others as l (l.objectType + l.objectId)}
              <Chip>{OBJECT_TYPE_LABEL[l.objectType]()}</Chip>
            {/each}
          </div>
        {/if}
        <div class="actions">
          <Popover
            bind:open={
              () => linkOpenFile === row.file.id, (v) => (linkOpenFile = v ? row.file.id : null)
            }
            placement="bottom"
          >
            {#snippet trigger()}
              <Button variant="ghost" size="sm">{m.attachments_link_to()}</Button>
            {/snippet}
            <div class="link-form">
              <Select
                size="sm"
                value={linkTypeByFile[row.file.id] ?? OBJECT_TYPE_OPTIONS[0].value}
                onchange={(v) =>
                  (linkTypeByFile = {
                    ...linkTypeByFile,
                    [row.file.id]: v as AttachmentObjectType,
                  })}
              >
                {#each OBJECT_TYPE_OPTIONS as o (o.value)}
                  <option value={o.value}>{o.label}</option>
                {/each}
              </Select>
              <input
                class="link-id"
                placeholder={m.attachments_link_object_id()}
                value={linkIdByFile[row.file.id] ?? ''}
                oninput={(e) =>
                  (linkIdByFile = {
                    ...linkIdByFile,
                    [row.file.id]: (e.currentTarget as HTMLInputElement).value,
                  })}
              />
              <Button size="sm" disabled={linkBusy} onclick={() => submitLink(row.file.id)}>
                {m.attachments_link_action()}
              </Button>
            </div>
          </Popover>
          <Button variant="ghost" size="sm" class="danger" onclick={() => onUnlink(row)}>
            {m.attachments_unlink()}
          </Button>
        </div>
      </div>
    {/each}
  {/if}
</div>

<ConfirmDialog
  open={pendingDeleteFileId !== null}
  title={m.attachments_delete_confirm_title()}
  message={m.attachments_delete_confirm_message()}
  failureMessage={m.attachments_delete_confirm_failure()}
  tone="danger"
  onconfirm={confirmDelete}
  onclose={() => (pendingDeleteFileId = null)}
/>

<style>
  .attachment-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .compact .row {
    padding: var(--space-1) 0;
  }
  /* `.name` is forwarded via `class` to <Button>'s own internal element, so
     it never carries this file's scoping hash — must be :global. */
  :global(.attachment-list .name) {
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .meta {
    white-space: nowrap;
  }
  .also-linked {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .actions {
    display: flex;
    gap: var(--space-1);
    margin-left: auto;
  }
  .link-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    min-width: 14rem;
  }
  .link-id {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: inherit;
    font-size: var(--font-size-caption, 12px);
  }
</style>
