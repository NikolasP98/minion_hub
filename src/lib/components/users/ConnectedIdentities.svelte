<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import IdentityLinkPopover from './IdentityLinkPopover.svelte';
  import { authClient } from '$lib/auth/auth-client';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

  type Identity = {
    id: string;
    provider: string;
    kind: 'oauth' | 'channel';
    externalId: string;
    displayName: string | null;
    verifiedAt: number | null;
  };

  let { userId, identities }: { userId: string; identities: Identity[] } = $props();

  let showPopover = $state(false);

  const CHANNEL_ICON: Record<string, string> = {
    whatsapp: '📱',
    telegram: '✈️',
    discord: '🎮',
    email: '✉️',
  };

  const oauthIdentities = $derived(identities.filter((i) => i.kind === 'oauth'));
  const channelIdentities = $derived(identities.filter((i) => i.kind === 'channel'));

  async function unlink(id: string) {
    if (!confirm('Unlink this identity?')) return;
    const res = await fetch(`/api/users/${userId}/identities/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toastSuccess('Identity removed');
      await invalidate('app:identities');
    } else {
      toastError('Remove failed');
    }
  }

  async function connectGoogle() {
    await authClient.linkSocial({ provider: 'google', callbackURL: '/settings/account?linked=google' });
  }

  async function onLinked() {
    showPopover = false;
    await invalidate('app:identities');
  }

  onMount(async () => {
    if (page.url.searchParams.get('linked') !== 'google') return;
    try {
      await fetch(`/api/users/${userId}/identities/sync-google`, { method: 'POST' });
      await goto('/settings/account', { replaceState: true, noScroll: true });
      await invalidate('app:identities');
    } catch (e) {
      toastError((e as Error).message);
    }
  });
</script>

<div class="bg-bg2 border border-border rounded-md p-3 space-y-3">
  <section class="space-y-2">
    <div class="text-[10px] uppercase tracking-wider text-muted font-semibold">Connected Accounts</div>
    {#if oauthIdentities.length === 0}
      <div class="text-muted text-xs">No connected accounts.</div>
    {:else}
      <div class="space-y-1">
        {#each oauthIdentities as id (id.id)}
          <div class="flex items-center gap-2 text-xs">
            <span>{id.provider === 'google' ? 'G' : '🔗'}</span>
            <span class="text-muted w-20">{id.provider}</span>
            <span class="text-foreground flex-1">{id.externalId}</span>
            {#if id.verifiedAt}
              <span class="text-green-400" title="verified">✓</span>
            {/if}
            <button class="text-muted hover:text-destructive bg-transparent border-none cursor-pointer" onclick={() => unlink(id.id)}>✕</button>
          </div>
        {/each}
      </div>
    {/if}
    <button class="text-xs px-2 py-1 rounded bg-transparent border border-border text-foreground hover:bg-muted/30" onclick={connectGoogle}>
      Connect Google
    </button>
  </section>

  <section class="space-y-2">
    <div class="text-[10px] uppercase tracking-wider text-muted font-semibold">Channels</div>
    {#if channelIdentities.length === 0}
      <div class="text-muted text-xs">No linked channels.</div>
    {:else}
      <div class="space-y-1">
        {#each channelIdentities as id (id.id)}
          <div class="flex items-center gap-2 text-xs">
            <span>{CHANNEL_ICON[id.provider] ?? '🔗'}</span>
            <span class="text-muted w-20">{id.provider}</span>
            <span class="text-foreground flex-1">{id.displayName ?? id.externalId}</span>
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
        + Link channel
      </button>
      {#if showPopover}
        <IdentityLinkPopover {userId} onCancel={() => (showPopover = false)} {onLinked} />
      {/if}
    </div>
  </section>
</div>
