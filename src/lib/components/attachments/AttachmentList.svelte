<script lang="ts">
  import { Button, Chip, Popover, Select } from '$lib/components/ui';
  import AttachmentTile from './AttachmentTile.svelte';
  import AttachmentPreviewSwitch from './AttachmentPreviewSwitch.svelte';
  import { attachmentPreview } from '$lib/attachments/preview-mode.svelte';
  import * as m from '$lib/paraglide/messages';
  import { formatBytes, fmtTimeAgo } from '$lib/utils/format';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import {
    attachmentDownloadUrl,
    linkAttachment,
    listAttachments,
    listTrashedAttachments,
    restoreAttachment,
    unlinkAttachment,
    type AttachmentObjectRef,
    type AttachmentObjectType,
    type AttachmentWithLinks,
    type TrashedAttachment,
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

  let rows = $state<AttachmentWithLinks[]>([]);
  let trashed = $state<TrashedAttachment[]>([]);
  let showTrash = $state(false);
  // Stale-while-revalidate: only the FIRST fetch has nothing to show. Later
  // refetches (the contact page re-runs this on every background refresh)
  // keep the current rows/empty text on screen instead of blanking them, which
  // made "No attachments yet." blink in and out every refresh cycle.
  let loaded = $state(false);

  async function load() {
    try {
      [rows, trashed] = await Promise.all([
        listAttachments(objectType, objectId),
        listTrashedAttachments(objectType, objectId).catch(() => []),
      ]);
    } catch {
      rows = [];
    } finally {
      loaded = true;
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

  // Two-layer deletion: "Delete" only hides this record's link (restorable
  // for 30 days from the list below); the file is reaped server-side once
  // every link has been hidden for the whole retention window.
  async function onDelete(row: AttachmentWithLinks) {
    try {
      await unlinkAttachment(row.file.id, { objectType, objectId });
    } catch {
      toastError(m.attachments_delete_failed());
      return;
    }
    await load();
  }

  async function onRestore(row: TrashedAttachment) {
    try {
      await restoreAttachment(row.file.id, { objectType, objectId });
    } catch {
      toastError(m.attachments_restore_failed());
      return;
    }
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

<div class="attachment-list" class:compact class:cards={attachmentPreview.mode === 'card'}>
  {#if loaded && rows.length === 0}
    <p class="t-caption">{m.attachments_empty()}</p>
  {:else if rows.length > 0}
    <div class="list-tools">
      <AttachmentPreviewSwitch />
    </div>
    <div class="tiles">
      {#each rows as row (row.file.id)}
        {@const others = otherLinks(row)}
        <AttachmentTile
          name={row.file.fileName}
          contentType={row.file.contentType}
          sizeBytes={row.file.sizeBytes}
          meta={fmtTimeAgo(new Date(row.file.createdAt).getTime())}
          preview={attachmentPreview.mode}
          thumb={() => attachmentDownloadUrl(row.file.id)}
          onopen={() => onOpen(row.file.id)}
        >
          {#if others.length > 0}
            <span>{m.attachments_also_linked()}</span>
            {#each others as l (l.objectType + l.objectId)}
              <Chip>{OBJECT_TYPE_LABEL[l.objectType]()}</Chip>
            {/each}
          {/if}
          {#snippet actions()}
            <Popover
              bind:open={
                () => linkOpenFile === row.file.id, (v) => (linkOpenFile = v ? row.file.id : null)
              }
              placement="bottom"
            >
              {#snippet trigger()}
                <Button variant="ghost" size="xs">{m.attachments_link_to()}</Button>
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
            <Button variant="ghost" size="xs" class="att-danger" onclick={() => onDelete(row)}>
              {m.attachments_delete()}
            </Button>
          {/snippet}
        </AttachmentTile>
      {/each}
    </div>
  {/if}
  {#if trashed.length > 0}
    <div class="trash">
      <Button variant="ghost" size="xs" onclick={() => (showTrash = !showTrash)}>
        {m.attachments_deleted_toggle({ n: trashed.length })}
      </Button>
      {#if showTrash}
        <p class="t-caption">{m.attachments_trash_hint()}</p>
        {#each trashed as row (row.file.id)}
          <AttachmentTile
            name={row.file.fileName}
            contentType={row.file.contentType}
            sizeBytes={row.file.sizeBytes}
            meta={m.attachments_deleted_ago({ ago: fmtTimeAgo(new Date(row.hiddenAt).getTime()) })}
            preview="off"
            muted
          >
            {#snippet actions()}
              <Button variant="ghost" size="xs" onclick={() => onRestore(row)}>
                {m.attachments_restore()}
              </Button>
            {/snippet}
          </AttachmentTile>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .attachment-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .list-tools {
    display: flex;
    justify-content: flex-end;
  }
  .tiles {
    display: flex;
    flex-direction: column;
  }
  .cards .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-3);
  }
  .trash {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }
  .trash > :global(.tile) {
    align-self: stretch;
  }
  .attachment-list :global(.att-danger:hover) {
    color: var(--color-danger-fg);
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
