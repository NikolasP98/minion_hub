<script lang="ts">
  import { onMount } from 'svelte';
  import IdentityLinkPopover from './IdentityLinkPopover.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

  type Identity = {
    id: string;
    channel: string;
    channelUserId: string;
    displayName: string | null;
    verifiedAt: number | null;
  };

  let { userId }: { userId: string } = $props();

  let identities = $state<Identity[]>([]);
  let loading = $state(false);
  let showPopover = $state(false);

  const ICON: Record<string, string> = {
    whatsapp: '📱',
    telegram: '✈️',
    discord: '🎮',
    email: '✉️',
  };

  async function load() {
    loading = true;
    try {
      const res = await fetch(`/api/users/${userId}/identities`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { identities: Identity[] };
      identities = data.identities;
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      loading = false;
    }
  }

  async function unlink(id: string) {
    if (!confirm('Unlink this identity?')) return;
    const res = await fetch(`/api/users/${userId}/identities/${id}`, { method: 'DELETE' });
    if (res.ok) {
      identities = identities.filter((i) => i.id !== id);
      toastSuccess('Identity removed');
    } else {
      toastError('Remove failed');
    }
  }

  function onLinked() {
    showPopover = false;
    load();
  }

  onMount(load);
</script>

<div class="bg-bg2 border border-border rounded-md p-3 space-y-2">
  <div class="text-[10px] uppercase tracking-wider text-muted font-semibold">Linked Identities</div>
  {#if loading}
    <div class="text-muted text-xs">Loading…</div>
  {:else if identities.length === 0}
    <div class="text-muted text-xs">No linked identities.</div>
  {:else}
    <div class="space-y-1">
      {#each identities as id (id.id)}
        <div class="flex items-center gap-2 text-xs">
          <span>{ICON[id.channel] ?? '🔗'}</span>
          <span class="text-muted w-20">{id.channel}</span>
          <span class="text-foreground flex-1">{id.displayName ?? id.channelUserId}</span>
          {#if id.verifiedAt}
            <span class="text-green-400" title="verified">✓</span>
          {:else}
            <span class="text-yellow-400" title="pending">⏳</span>
          {/if}
          <button class="text-muted hover:text-destructive bg-transparent border-none cursor-pointer" onclick={() => unlink(id.id)}>✕</button>
        </div>
      {/each}
    </div>
  {/if}
  <div class="relative">
    <button class="text-xs px-2 py-1 rounded bg-transparent border border-border text-foreground hover:bg-muted/30" onclick={() => (showPopover = !showPopover)}>
      + Link identity
    </button>
    {#if showPopover}
      <IdentityLinkPopover {userId} onCancel={() => (showPopover = false)} onLinked={onLinked} />
    {/if}
  </div>
</div>
