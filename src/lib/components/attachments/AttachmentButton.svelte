<script lang="ts">
  import { Paperclip } from 'lucide-svelte';
  import {
    Button,
    Tooltip,
    iconSizes,
    type ButtonSize,
    type ButtonVariant,
  } from '$lib/components/ui';
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
    variant?: ButtonVariant;
    label?: string;
    disabled?: boolean;
    /** Where the size/type hint renders: a caption beside the button (default)
     *  or a hover tooltip on it (compact card headers). */
    hint?: 'inline' | 'tooltip';
    class?: string;
  }

  let {
    objectType,
    objectId,
    onuploaded,
    size = 'sm',
    variant = 'outline',
    label,
    disabled = false,
    hint = 'inline',
    class: className,
  }: Props = $props();

  const hintText = $derived(
    m.attachments_hint({ max: formatBytes(ATTACHMENT_LIMITS.maxFileBytes) }),
  );

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

{#snippet button()}
  <Button
    {variant}
    {size}
    class={className}
    disabled={disabled || progress !== null}
    onclick={() => inputEl.click()}
  >
    <Paperclip size={iconSizes.xs} />
    {progress !== null
      ? m.attachments_uploading({ pct: progress })
      : (label ?? m.attachments_add())}
  </Button>
{/snippet}

<div class="attachment-button">
  {#if hint === 'tooltip'}
    <Tooltip label={hintText} openDelay={300}>{@render button()}</Tooltip>
  {:else}
    {@render button()}
  {/if}
  <input
    bind:this={inputEl}
    type="file"
    multiple
    {accept}
    hidden
    disabled={disabled || progress !== null}
    onchange={onFiles}
  />
  {#if hint === 'inline'}
    <span class="t-caption">{hintText}</span>
  {/if}
</div>

<style>
  .attachment-button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  /* Tooltip's trigger wrapper is a plain block <span>; as a block around an
     inline-flex button it adds a baseline gap, so caption-height headers came
     out 1px taller than their sibling cards. */
  .attachment-button > :global(span) {
    display: inline-flex;
    align-items: center;
  }
</style>
