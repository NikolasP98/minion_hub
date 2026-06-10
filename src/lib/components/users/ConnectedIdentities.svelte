<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import { supabaseBrowser } from '$lib/supabase/client';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

  type Identity = {
    id: string;
    source?: 'turso' | 'supabase';
    provider: string;
    kind: 'oauth' | 'channel';
    externalId: string;
    displayName: string | null;
    verifiedAt: number | null;
  };

  let { userId, identities }: { userId: string; identities: Identity[] } = $props();

  const oauthIdentities = $derived(identities.filter((i) => i.kind === 'oauth'));

  // A user must keep at least one login provider — never offer to remove the
  // last one.
  const canRemoveOauth = $derived(oauthIdentities.length > 1);
  // Only providers that aren't already connected can be added.
  const hasGoogle = $derived(oauthIdentities.some((i) => i.provider === 'google'));

  async function unlink(identity: Identity) {
    if (!confirm('Unlink this identity?')) return;
    const qs = identity.source ? `?source=${identity.source}` : '';
    const res = await fetch(`/api/users/${userId}/identities/${identity.id}${qs}`, { method: 'DELETE' });
    if (res.ok) {
      toastSuccess('Identity removed');
      await invalidate('app:identities');
    } else {
      toastError('Remove failed');
    }
  }

  async function connectGoogle() {
    // Supabase Auth manual identity linking (requires "Manual linking" enabled in
    // the Supabase project's auth settings). Returns through /auth/callback, which
    // exchanges the code (linking the Google identity to the current user) +
    // syncs user_identities, then redirects to /account?linked=google.
    const supabase = supabaseBrowser();
    const next = encodeURIComponent('/account?linked=google');
    await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${next}` },
    });
  }

  onMount(async () => {
    if (page.url.searchParams.get('linked') !== 'google') return;
    try {
      await fetch(`/api/users/${userId}/identities/sync-google`, { method: 'POST' });
      await goto('/account', { replaceState: true, noScroll: true });
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
            {#if canRemoveOauth}
              <button class="text-muted hover:text-destructive bg-transparent border-none cursor-pointer" onclick={() => unlink(id)}>✕</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if !hasGoogle}
      <button class="text-xs px-2 py-1 rounded bg-transparent border border-border text-foreground hover:bg-muted/30" onclick={connectGoogle}>
        Connect Google
      </button>
    {/if}
  </section>
</div>
