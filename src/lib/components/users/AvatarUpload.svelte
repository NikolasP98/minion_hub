<script lang="ts">
  import { invalidate } from '$app/navigation';
  import UserAvatar from './UserAvatar.svelte';
  import { updateProfile } from '$lib/remote/profile.remote';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { Camera, Loader2, Trash2 } from 'lucide-svelte';

  interface Props {
    name?: string | null;
    email?: string | null;
    src?: string | null;
  }

  let { name = null, email = null, src = null }: Props = $props();

  let fileInput: HTMLInputElement | null = $state(null);
  let busy = $state(false);

  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toastError('Please choose an image file');
      return;
    }
    if (file.size > MAX_BYTES) {
      toastError('Image must be under 5 MB');
      return;
    }

    busy = true;
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', 'avatars');
      const up = await fetch('/api/files', { method: 'POST', body: fd });
      if (!up.ok) throw new Error('upload failed');
      const { id } = (await up.json()) as { id: string };

      await updateProfile({ avatarFileId: id });
      toastSuccess('Avatar updated');
      await invalidate('app:user');
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function removeAvatar() {
    busy = true;
    try {
      await updateProfile({ removeAvatar: true });
      toastSuccess('Avatar removed');
      await invalidate('app:user');
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex items-center gap-4">
  <button
    type="button"
    class="relative group rounded-full bg-transparent border-none p-0 cursor-pointer disabled:cursor-wait"
    onclick={() => fileInput?.click()}
    disabled={busy}
    title="Change avatar"
    aria-label="Change avatar"
  >
    <UserAvatar {name} {email} {src} size={72} />
    <span
      class="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
    >
      {#if busy}
        <Loader2 size={20} class="text-white animate-spin" />
      {:else}
        <Camera size={20} class="text-white" />
      {/if}
    </span>
  </button>

  <div class="space-y-1">
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="text-xs px-2.5 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50"
        onclick={() => fileInput?.click()}
        disabled={busy}
      >
        Upload photo
      </button>
      {#if src}
        <button
          type="button"
          class="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-transparent border border-border text-muted-foreground hover:text-destructive cursor-pointer disabled:opacity-50"
          onclick={removeAvatar}
          disabled={busy}
        >
          <Trash2 size={12} /> Remove
        </button>
      {/if}
    </div>
    <p class="text-[11px] text-muted-strong">JPG, PNG or GIF · up to 5 MB</p>
  </div>

  <input
    bind:this={fileInput}
    type="file"
    accept="image/*"
    class="hidden"
    onchange={onPick}
  />
</div>
