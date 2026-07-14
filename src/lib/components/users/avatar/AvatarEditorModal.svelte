<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { invalidate } from '$app/navigation';
  import * as imageCropper from '@zag-js/image-cropper';
  import * as fileUpload from '@zag-js/file-upload';
  import { useMachine, normalizeProps } from '@zag-js/svelte';
  import { Button, Modal } from '$lib/components/ui';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { UploadCloud, Trash2, RotateCcw } from 'lucide-svelte';
  import { dicebearPresets } from './dicebear';
  import UserAvatar from '../UserAvatar.svelte';

  let nextId = 0;
  const cropperId = `avatar-crop-${nextId}`;
  const uploadId = `avatar-up-${nextId++}`;

  let {
    open = $bindable(false),
    userId,
    name,
    email,
    src,
  }: {
    open?: boolean;
    userId: string;
    name: string | null;
    email: string | null;
    src: string | null;
  } = $props();

  // Pending selection: either a local file to crop, or a preset URL.
  let cropSrc = $state<string | null>(null); // object URL of an uploaded file
  let presetUrl = $state<string | null>(null); // chosen dicebear url
  let busy = $state(false);

  const presets = $derived(dicebearPresets(userId));
  const hasPending = $derived(!!cropSrc || !!presetUrl);

  function revoke() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    cropSrc = null;
  }
  function resetPending() {
    revoke();
    presetUrl = null;
  }

  // ── File drop / pick (Zag file-upload) ──────────────────────────────────
  const upload = useMachine(fileUpload.machine, () => ({
    id: uploadId,
    accept: 'image/*',
    maxFiles: 1,
    maxFileSize: 5 * 1024 * 1024,
    onFileChange({ acceptedFiles, rejectedFiles }: fileUpload.FileChangeDetails) {
      if (rejectedFiles.length) {
        toastError(m.usersui_imageTooLarge());
        return;
      }
      const file = acceptedFiles[0];
      if (!file) return;
      resetPending();
      cropSrc = URL.createObjectURL(file);
    },
  }));
  const up = $derived(fileUpload.connect(upload, normalizeProps));

  // ── Crop (Zag image-cropper), only mounted when cropSrc set ──────────────
  const cropper = useMachine(imageCropper.machine as any, () => ({
    id: cropperId,
    image: cropSrc ?? '',
    aspectRatio: 1,
    cropShape: 'circle' as const,
  }));
  const crop = $derived(imageCropper.connect(cropper as any, normalizeProps));

  async function persistFile(blob: Blob): Promise<boolean> {
    const fd = new FormData();
    fd.append('file', new File([blob], 'avatar.png', { type: blob.type || 'image/png' }));
    fd.append('category', 'avatars');
    const upRes = await fetch('/api/files', { method: 'POST', body: fd });
    if (!upRes.ok) return false;
    const { id } = (await upRes.json()) as { id: string };
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ avatarFileId: id }),
    });
    return res.ok;
  }

  async function persistUrl(url: string | null): Promise<boolean> {
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ avatarUrl: url }),
    });
    return res.ok;
  }

  async function save() {
    busy = true;
    try {
      let ok = false;
      if (cropSrc) {
        const blob = await crop.getCroppedImage({ type: 'image/png', output: 'blob' });
        ok = blob instanceof Blob ? await persistFile(blob) : false;
      } else if (presetUrl) {
        ok = await persistUrl(presetUrl);
      }
      if (!ok) throw new Error(m.usersui_avatarSaveFailed());
      toastSuccess(m.usersui_avatarUpdated());
      await invalidate('app:user');
      close();
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    busy = true;
    try {
      if (!(await persistUrl(null))) throw new Error(m.usersui_avatarRemoveFailed());
      toastSuccess(m.usersui_avatarRemoved());
      await invalidate('app:user');
      close();
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      busy = false;
    }
  }

  function close() {
    resetPending();
    up.clearFiles();
    open = false;
  }
</script>

<Modal bind:open title={m.usersui_editAvatar()} size="md" onclose={close}>
  <div class="space-y-4">
    <!-- Stage: cropper, preset preview, or the drop zone -->
    {#if cropSrc}
      <div class="space-y-2">
        <div
          {...crop.getRootProps()}
          class="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-[var(--radius-lg)] bg-bg select-none"
        >
          <div {...crop.getViewportProps()} class="absolute inset-0">
            <!-- svelte-ignore a11y_missing_attribute -->
            <img {...crop.getImageProps()} class="pointer-events-none select-none" />
          </div>
          <div
            {...crop.getSelectionProps()}
            class="ring-2 ring-accent/80 shadow-[var(--crop-mask-shadow)]"
            style="--crop-mask-shadow: 0 0 0 9999px color-mix(in srgb, var(--color-overlay) 75%, transparent);"
          >
            {#each ['nw', 'ne', 'se', 'sw'] as pos (pos)}
              <div {...crop.getHandleProps({ position: pos as 'nw' })} class="h-2.5 w-2.5 rounded-full bg-accent border border-bg"></div>
            {/each}
          </div>
        </div>
        <Button variant="ghost" size="xs"
          class="mx-auto flex items-center gap-1.5 text-[length:var(--font-size-label)] text-muted hover:text-foreground bg-transparent border-none cursor-pointer"
          onclick={resetPending}
        >
          <RotateCcw size={12} /> {m.usersui_chooseDifferentImage()}
        </Button>
      </div>
    {:else if presetUrl}
      <div class="flex flex-col items-center gap-2 py-2">
        <img src={presetUrl} alt={m.usersui_selectedAvatar()} class="h-28 w-28 rounded-full object-cover bg-bg3 border border-border" />
        <Button variant="ghost" size="xs"
          class="flex items-center gap-1.5 text-[length:var(--font-size-label)] text-muted hover:text-foreground bg-transparent border-none cursor-pointer"
          onclick={resetPending}
        >
          <RotateCcw size={12} /> {m.usersui_clearSelection()}
        </Button>
      </div>
    {:else}
      <!-- Drop zone with a subtle borderless upload button -->
      <div
        {...up.getRootProps()}
        class="rounded-[var(--radius-lg)] border border-dashed border-border bg-bg/40 px-4 py-8 text-center"
      >
        <div {...up.getDropzoneProps()} class="flex flex-col items-center gap-2">
          <UserAvatar {name} {email} {src} size={64} />
          <p class="text-xs text-muted-foreground">{m.usersui_dragImageHere()}</p>
          <Button variant="ghost" size="xs"
            {...up.getTriggerProps()}
            class="inline-flex items-center gap-1.5 text-sm text-accent hover:underline bg-transparent border-none cursor-pointer"
          >
            <UploadCloud size={15} /> {m.usersui_upload()}
          </Button>
          <p class="text-[length:var(--font-size-label)] text-muted-strong">{m.usersui_imageLimitNote()}</p>
        </div>
        <input {...up.getHiddenInputProps()} />
      </div>
    {/if}

    <!-- Horizontal preset picker -->
    <div class="space-y-1.5">
      <p class="text-[length:var(--font-size-telemetry)] uppercase tracking-wider text-muted font-semibold">{m.usersui_orPickGeneratedAvatar()}</p>
      <div class="flex gap-2 overflow-x-auto pb-1.5 -mx-0.5 px-0.5">
        {#each presets as p (p.style)}
          <Button variant="ghost" size="xs"
            class="shrink-0 rounded-full p-0.5 bg-transparent cursor-pointer transition-colors {presetUrl === p.url
              ? 'ring-2 ring-accent'
              : 'ring-1 ring-border hover:ring-[var(--color-border-strong)]'}"
            title={p.label}
            onclick={() => {
              resetPending();
              presetUrl = p.url;
            }}
          >
            <img src={p.url} alt={p.label} loading="lazy" class="h-11 w-11 rounded-full bg-bg3 object-cover" />
          </Button>
        {/each}
      </div>
    </div>
  </div>

  {#snippet footer()}
    <Button variant="primary" size="sm"
      class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-transparent border border-border text-muted-foreground hover:text-destructive cursor-pointer disabled:opacity-50 mr-auto"
      onclick={remove}
      disabled={busy || !src}
    >
      <Trash2 size={13} /> {m.common_remove()}
    </Button>
    <Button variant="ghost" size="xs"
      class="text-xs px-3 py-1.5 rounded-md bg-transparent border border-border text-foreground hover:bg-muted/30 cursor-pointer"
      onclick={close}
    >
      {m.common_cancel()}
    </Button>
    <Button variant="ghost" size="xs"
      class="text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50"
      onclick={save}
      disabled={busy || !hasPending}
    >
      {busy ? m.usersui_saving() : m.common_save()}
    </Button>
  {/snippet}
</Modal>
