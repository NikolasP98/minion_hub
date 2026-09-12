<script lang="ts">
  import { Paperclip } from 'lucide-svelte';
  import { Button, iconSizes, type ButtonSize } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatBytes } from '$lib/utils/format';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { ATTACHMENT_LIMITS, ATTACHMENT_MIME_ALLOWLIST } from '$lib/attachments/limits';
  import {
    uploadAttachment,
    AttachmentUploadError,
    type AttachmentObjectType,
    type FinalizeResult,
  } from '$lib/attachments/upload';

  interface Props {
    objectType: AttachmentObjectType;
    objectId: string;
    onuploaded?: (result: FinalizeResult) => void;
    size?: ButtonSize;
    label?: string;
    disabled?: boolean;
  }

  let { objectType, objectId, onuploaded, size = 'sm', label, disabled = false }: Props = $props();

  const accept = [...ATTACHMENT_MIME_ALLOWLIST].join(',');
  const ERROR_MESSAGE: Record<string, () => string> = {
    too_large: m.attachments_error_too_large,
    mime_not_allowed: m.attachments_error_mime_not_allowed,
    quota_exceeded: m.attachments_error_quota_exceeded,
  };

  let inputEl: HTMLInputElement;
  let progress = $state<number | null>(null);

  async function onFiles(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const picked = Array.from(target.files ?? []);
    target.value = '';
    for (const file of picked) {
      progress = 0;
      try {
        const result = await uploadAttachment(file, [{ objectType, objectId }], {
          onProgress: (pct) => (progress = pct),
        });
        onuploaded?.(result);
      } catch (err) {
        const code = err instanceof AttachmentUploadError ? err.code : 'unknown';
        const description =
          ERROR_MESSAGE[code]?.() ?? (err instanceof Error ? err.message : String(err));
        toastError(m.attachments_upload_failed({ file: file.name }), description);
      } finally {
        progress = null;
      }
    }
  }
</script>

<div class="attachment-button">
  <Button
    variant="outline"
    {size}
    disabled={disabled || progress !== null}
    onclick={() => inputEl.click()}
  >
    <Paperclip size={iconSizes.xs} />
    {progress !== null
      ? m.attachments_uploading({ pct: progress })
      : (label ?? m.attachments_add())}
  </Button>
  <input
    bind:this={inputEl}
    type="file"
    multiple
    {accept}
    hidden
    disabled={disabled || progress !== null}
    onchange={onFiles}
  />
  <span class="t-caption">
    {m.attachments_hint({ max: formatBytes(ATTACHMENT_LIMITS.maxFileBytes) })}
  </span>
</div>

<style>
  .attachment-button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
</style>
