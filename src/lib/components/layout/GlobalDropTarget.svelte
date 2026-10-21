<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';
  import { Upload, Inbox, File as FileIcon } from 'lucide-svelte';
  import {
    useDropRegistry,
    DropUnavailableError,
    isFileDrag,
    type DropDestination,
  } from '$lib/shell/drop-context.svelte';
  import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
  import {
    validateAttachment,
    ATTACHMENT_LIMITS,
    ATTACHMENT_MIME_ALLOWLIST,
  } from '$lib/attachments/limits';
  import { AttachmentUploadError } from '$lib/attachments/upload';
  import { ApiError } from '$lib/api/fetch-json';
  import { fetchJson } from '$lib/api/fetch-json';
  import { formatBytes } from '$lib/utils/format';
  import * as m from '$lib/paraglide/messages';

  const registry = useDropRegistry()!;
  let dragging = $state(false);
  let files = $state<File[]>([]);
  let error = $state('');
  let busy = $state(false);
  let input: HTMLInputElement;
  let controller: AbortController | undefined;
  let capturedOwner: string | null = null;
  let inbox = $state<{ id: string; fileName: string }[]>([]);
  // Generic inbox files use the authenticated file API, not a business
  // module capability. Record uploads still enforce their own module RBAC.
  const canUpload = () => preferenceOwner() !== null;

  $effect(() => {
    const owner = preferenceOwner();
    if (capturedOwner !== owner) {
      controller?.abort();
      files = [];
      inbox = [];
      error = '';
      busy = false;
      registry.open = false;
      capturedOwner = owner;
    }
  });
  onDestroy(() => controller?.abort());

  function choose(picked: File[]) {
    error = '';
    const total = picked.reduce((sum, file) => sum + file.size, 0);
    if (picked.length > 20 || total > 100 * 1024 * 1024) {
      error = m.shell_drop_batch_limit();
      registry.open = true;
      return;
    }
    for (const file of picked) {
      const result = validateAttachment({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!result.ok) {
        error = result.message;
        registry.open = true;
        return;
      }
    }
    files = picked;
    registry.open = true;
  }
  function drag(event: DragEvent) {
    if (!isFileDrag(event.dataTransfer) || event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }
  function drop(event: DragEvent) {
    dragging = false;
    // A local editor/uploader that handled this event keeps ownership.
    if (!isFileDrag(event.dataTransfer) || event.defaultPrevented) return;
    event.preventDefault();
    if (busy || (registry.open && files.length)) return;
    choose([...event.dataTransfer!.files]);
  }
  async function deliver(destination: DropDestination) {
    const owner = preferenceOwner();
    if (busy || !owner || !files.length) return;
    controller = new AbortController();
    const signal = controller.signal;
    busy = true;
    error = '';
    try {
      for (const file of [...files]) {
        try {
          await registry.deliver(destination, [file], signal);
        } catch (failure) {
          const rejected =
            failure instanceof DropUnavailableError ||
            (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) ||
            (failure instanceof AttachmentUploadError && failure.code !== 'unknown');
          if (!rejected && !signal.aborted) {
            // A lost upload response may already have committed. Exclude this
            // file from Retry; the user can inspect the destination/inbox.
            files = files.filter((entry) => entry !== file);
            error = m.shell_drop_unknown({ file: file.name });
          }
          throw failure;
        }
        if (signal.aborted || preferenceOwner() !== owner) return;
        files = files.filter((entry) => entry !== file);
      }
      if (signal.aborted || preferenceOwner() !== owner) return;
      files = [];
      registry.open = false;
    } catch {
      if (!signal.aborted && preferenceOwner() === owner) error ||= m.shell_drop_failed();
    } finally {
      if (preferenceOwner() === owner) busy = false;
    }
  }
  // The existing generic file API stores inbox uploads durably with uploader
  // identity, size/type/quota validation and tenant-scoped authorization.
  const inboxDestination: DropDestination = {
    id: 'file-inbox',
    label: m.shell_drop_inbox(),
    available: canUpload,
    async receive(picked, signal) {
      for (const file of [...picked]) {
        if (signal.aborted) return;
        if (file.size > ATTACHMENT_LIMITS.proxiedMaxBytes)
          throw new AttachmentUploadError('too_large', 'Inbox upload too large');
        const form = new FormData();
        form.set('file', file);
        form.set('category', 'inbox');
        const saved = await fetchJson<{ id: string }>('/api/files', {
          method: 'POST',
          body: form,
          signal,
        });
        if (typeof saved.id !== 'string' || !saved.id) throw new Error('Missing upload receipt');
        if (!signal.aborted) inbox = [{ id: saved.id, fileName: file.name }, ...inbox];
        // Remove each acknowledged success immediately; retry never replays it.
        files = files.filter((entry) => entry !== file);
      }
      // Listing is revalidated on the next open; an acknowledged upload is never retried for a failed read.
    },
  };
  $effect(() => registry.register(inboxDestination));
  async function loadInbox(signal?: AbortSignal) {
    const owner = preferenceOwner();
    const result = await fetchJson<{ files: { id: string; fileName: string }[] }>(
      '/api/files?category=inbox',
      { signal },
    );
    if (
      !Array.isArray(result.files) ||
      result.files.some(
        (file) => !file || typeof file.id !== 'string' || typeof file.fileName !== 'string',
      )
    )
      throw new Error('Invalid file inbox response');
    if (preferenceOwner() === owner && !signal?.aborted) inbox = result.files;
  }
  async function openFile(id: string) {
    const owner = preferenceOwner();
    try {
      const result = await fetchJson<{ file: { url: string } }>(
        `/api/files/${encodeURIComponent(id)}`,
      );
      if (preferenceOwner() !== owner) return;
      const url = new URL(result.file.url);
      if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      )
        throw new Error('Invalid file URL');
      window.open(url.href, '_blank', 'noopener,noreferrer');
    } catch {
      error = m.shell_drop_failed();
    }
  }
  $effect(() => {
    const owner = preferenceOwner();
    if (registry.open && owner)
      void loadInbox().catch(() => {
        if (preferenceOwner() === owner) error = m.common_error();
      });
  });
</script>

<svelte:window
  ondragenter={drag}
  ondragover={drag}
  ondragleave={(event) => {
    if (!event.relatedTarget) dragging = false;
  }}
  ondrop={drop}
  onblur={() => (dragging = false)}
  onkeydown={(event) => {
    if (event.key === 'Escape') dragging = false;
  }}
/>

{#if dragging}
  <div class="drop-hint" role="status"><Upload size={iconSizes.lg} />{m.shell_drop_hint()}</div>
{/if}
<Dialog bind:open={registry.open} title={m.shell_drop_title()} dismissible={!busy}>
  <div class="drop-content">
    <p class="t-body">{m.shell_drop_hint()}</p>
    <Button variant="outline" onclick={() => input.click()} disabled={busy}>
      <Upload size={iconSizes.sm} />{m.shell_drop_pick()}
    </Button>
    <input
      bind:this={input}
      type="file"
      multiple
      hidden
      accept={[...ATTACHMENT_MIME_ALLOWLIST].join(',')}
      onchange={() => {
        choose([...(input.files ?? [])]);
        input.value = '';
      }}
    />
    {#each files as file}
      <p class="t-caption">{file.name} · {formatBytes(file.size)}</p>
    {/each}
    {#if files.length}
      <div class="destinations">
        {#each registry.available as destination (destination.id)}
          <Button variant="outline" loading={busy} onclick={() => void deliver(destination)}>
            <Inbox size={iconSizes.sm} />{destination.label}
          </Button>
        {/each}
      </div>
      <p class="t-caption">
        {m.shell_drop_inbox_limit({ max: formatBytes(ATTACHMENT_LIMITS.proxiedMaxBytes) })}
      </p>
    {/if}
    {#if error}<p class="drop-error t-body" role="alert">{error}</p>{/if}
    {#if inbox.length}
      <h2 class="t-title">{m.shell_drop_inbox()}</h2>
      {#each inbox as file (file.id)}
        <Button variant="ghost" onclick={() => void openFile(file.id)}
          ><FileIcon size={iconSizes.sm} />{file.fileName}</Button
        >
      {/each}
    {/if}
  </div>
</Dialog>

<style>
  .drop-hint {
    position: fixed;
    inset: var(--space-4);
    z-index: var(--layer-modal);
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-control-gap);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-lg);
    background: var(--color-overlay);
    color: var(--color-text-primary);
  }
  .drop-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-control-gap);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .destinations {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .drop-error {
    color: var(--color-danger-fg);
  }
</style>
