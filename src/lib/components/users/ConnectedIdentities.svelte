<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { onMount } from 'svelte';
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import { supabaseBrowser } from '$lib/supabase/client';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { Check, X } from 'lucide-svelte';

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
    if (!confirm(m.usersui_unlinkIdentityConfirm())) return;
    const qs = identity.source ? `?source=${identity.source}` : '';
    const res = await fetch(`/api/users/${userId}/identities/${identity.id}${qs}`, { method: 'DELETE' });
    if (res.ok) {
      toastSuccess(m.usersui_identityRemoved());
      await invalidate('app:identities');
    } else {
      toastError(m.usersui_removeFailed());
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
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
        scopes:
          'email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events',
      },
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

<div class="bg-bg2 border border-border rounded-md overflow-hidden">
  <div class="px-3 py-2.5 border-b border-border">
    <div class="text-[10px] uppercase tracking-wider text-muted font-semibold">{m.usersui_signInAccounts()}</div>
  </div>

  {#if oauthIdentities.length === 0}
    <div class="text-muted text-xs px-3 py-2.5">{m.usersui_noSignInAccounts()}</div>
  {:else}
    <div class="divide-y divide-border/60">
      {#each oauthIdentities as id (id.id)}
        <div class="flex items-center gap-3 px-3 py-2.5">
          <span class="grid place-items-center h-6 w-6 rounded-full bg-bg3/50 text-[11px] font-semibold text-foreground shrink-0">
            {id.provider === 'google' ? 'G' : id.provider.charAt(0).toUpperCase()}
          </span>
          <span class="flex-1 min-w-0">
            <span class="block text-sm text-foreground capitalize">{id.provider}</span>
            <span class="block text-[11px] text-muted-foreground truncate">{id.externalId}</span>
          </span>
          {#if id.verifiedAt}
            <span class="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/12 text-green-400 border border-green-500/20 shrink-0">
              <Check size={10} /> {m.usersui_verified()}
            </span>
          {/if}
          {#if canRemoveOauth}
            <button
              class="grid place-items-center h-6 w-6 rounded text-muted hover:text-destructive hover:bg-bg3/40 bg-transparent border-none cursor-pointer shrink-0"
              title={m.usersui_disconnect()}
              onclick={() => unlink(id)}
            >
              <X size={13} />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if !hasGoogle}
    <div class="px-3 py-2.5 border-t border-border/60">
      <button class="text-xs px-2.5 py-1.5 rounded-md bg-transparent border border-border text-foreground hover:bg-muted/30 cursor-pointer" onclick={connectGoogle}>
        {m.usersui_connectGoogle()}
      </button>
    </div>
  {/if}
</div>
