<script lang="ts">
  import { invalidate } from '$app/navigation';
  import AvatarMenu from './AvatarMenu.svelte';
  import EditableName from './EditableName.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { ShieldCheck, CalendarDays } from 'lucide-svelte';

  interface Props {
    userId: string;
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
    role: string | null;
    createdAt: string | null;
  }

  let { userId, displayName, email, avatarUrl, role, createdAt }: Props = $props();

  async function saveName(name: string): Promise<boolean> {
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      if (!res.ok) throw new Error('save failed');
      toastSuccess('Name updated');
      await invalidate('app:user');
      return true;
    } catch (e) {
      toastError((e as Error).message);
      return false;
    }
  }

  const memberSince = $derived.by(() => {
    if (!createdAt) return null;
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  });
</script>

<div class="bg-bg2 border border-border rounded-md p-5">
  <div class="flex items-start gap-4">
    <AvatarMenu {userId} name={displayName} {email} src={avatarUrl} size={88} />

    <div class="min-w-0 flex-1 pt-0.5">
      <EditableName value={displayName ?? ''} onCommit={saveName} />
      <p class="mt-0.5 text-sm text-muted-foreground truncate">{email ?? '—'}</p>

      <!-- Quiet metadata strip: facts, not a form grid -->
      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span class="inline-flex items-center gap-1.5">
          <ShieldCheck size={13} class="text-accent" />
          <span class="capitalize text-foreground">{role ?? 'user'}</span>
        </span>
        {#if memberSince}
          <span class="inline-flex items-center gap-1.5">
            <CalendarDays size={13} class="text-muted-strong" />
            Joined {memberSince}
          </span>
        {/if}
      </div>
    </div>
  </div>
</div>
