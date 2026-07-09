<script lang="ts">
  import { invalidate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { Building2, RefreshCw, Check, Plus } from 'lucide-svelte';
  import { PageHeader } from '$lib/components/ui';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { supabaseBrowser } from '$lib/supabase/client';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import type { GmailAccountRow } from './+page.server';

  let { data }: { data: PageData } = $props();
  const accounts = $derived(data.accounts as GmailAccountRow[]);

  let busy = $state<string | null>(null);

  // Health pill per row. `health.ok && hasGmail` is the only green state —
  // a valid token WITHOUT the Gmail scope is precisely the silent failure this
  // page exists to surface (account linked before Gmail scopes were requested).
  function healthPill(a: GmailAccountRow): { label: string; tone: 'ok' | 'warn' | 'err' | 'muted' } {
    if (!a.health) return { label: m.gmailch_healthUnknown(), tone: 'muted' };
    if (!a.health.ok) {
      return a.health.reason === 'revoked'
        ? { label: m.gmailch_healthRevoked(), tone: 'err' }
        : { label: m.gmailch_healthUnreachable(), tone: 'muted' };
    }
    if (!a.health.hasGmail) return { label: m.gmailch_healthNoGmail(), tone: 'warn' };
    return { label: m.gmailch_healthOk(), tone: 'ok' };
  }
  const needsReconnect = (a: GmailAccountRow) =>
    a.health !== null && (!a.health.ok ? a.health.reason === 'revoked' : !a.health.hasGmail);

  async function toggleFeed(a: GmailAccountRow) {
    if (!a.identityId) return;
    busy = a.identityId;
    try {
      const res = a.subscribed
        ? await fetch(`/api/shared-identities/${a.identityId}`, { method: 'DELETE' })
        : await fetch('/api/shared-identities', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identityId: a.identityId }),
          });
      if (!res.ok) throw new Error(await res.text());
      toastSuccess(a.subscribed ? m.gmailch_removedFromFeed() : m.gmailch_addedToFeed());
      await invalidate('app:gmail-accounts');
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      busy = null;
    }
  }

  // Same manual-linking flow as /account's Connected identities, returning
  // here so the health pill re-probes with the fresh token.
  async function reconnectGoogle() {
    const supabase = supabaseBrowser();
    const next = encodeURIComponent('/channels/gmail?linked=google');
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
      await fetch(`/api/users/${data.userId}/identities/sync-google`, { method: 'POST' });
      await goto('/channels/gmail', { replaceState: true, noScroll: true });
      await invalidate('app:gmail-accounts');
      toastSuccess(m.gmailch_reconnected());
    } catch (e) {
      toastError((e as Error).message);
    }
  });
</script>

<div class="flex h-full min-h-0 flex-col">
  <PageHeader title="Gmail" subtitle={m.gmailch_subtitle()}>
    {#snippet leading()}
      <ChannelBrandIcon channel="gmail" size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
    {#if accounts.length === 0}
      <div class="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <ChannelBrandIcon channel="gmail" size={32} class="opacity-40" />
        <p class="text-sm">{m.gmailch_empty()}</p>
        <button type="button" class="action-btn" onclick={reconnectGoogle}>
          <Plus size={14} />{m.gmailch_connect()}
        </button>
      </div>
    {:else}
      <div class="account-list">
        {#each accounts as a (a.kind + a.email)}
          {@const pill = healthPill(a)}
          <div class="account-row">
            <div class="icon-wrap">
              <ChannelBrandIcon channel="gmail" size={20} class="text-accent" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-sm text-foreground truncate">
                  {a.displayName ?? a.ownerName ?? a.email}
                </span>
                {#if a.kind === 'shared'}
                  <span class="badge"><Building2 size={10} />{m.gmailch_sharedBadge()}</span>
                {:else}
                  <span class="badge muted">{m.gmailch_ownBadge()}</span>
                {/if}
                <span class="status-pill {pill.tone}">{pill.label}</span>
              </div>
              {#if (a.displayName ?? a.ownerName) !== null}
                <p class="text-xs text-muted-foreground mt-0.5 truncate">{a.email}</p>
              {/if}
              {#if needsReconnect(a)}
                <p class="text-xs mt-1 warn-note">
                  {#if a.kind === 'own'}
                    {m.gmailch_reconnectHintOwn()}
                  {:else}
                    {m.gmailch_reconnectHintShared({ email: a.email })}
                  {/if}
                </p>
              {/if}
            </div>
            <div class="flex items-center gap-2 self-center shrink-0">
              {#if a.kind === 'shared'}
                <button
                  type="button"
                  class="action-btn"
                  class:active={a.subscribed}
                  disabled={busy === a.identityId}
                  onclick={() => toggleFeed(a)}
                >
                  {#if a.subscribed}<Check size={14} />{m.gmailch_inFeed()}{:else}<Plus
                      size={14}
                    />{m.gmailch_addToFeed()}{/if}
                </button>
              {:else}
                <button type="button" class="action-btn" onclick={reconnectGoogle}>
                  <RefreshCw size={14} />{m.gmailch_reconnect()}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <p class="text-xs text-muted-foreground mt-4 max-w-xl">{m.gmailch_footnote()}</p>
    {/if}
  </div>
</div>

<style>
  .account-list {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    max-width: 46rem;
  }
  .account-row {
    display: flex;
    align-items: flex-start;
    gap: 0.875rem;
    padding: 1rem;
    border-radius: var(--radius-lg, 0.75rem);
    border: 1px solid var(--hairline);
    background: var(--color-bg2, rgba(255, 255, 255, 0.02));
  }
  .icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    flex-shrink: 0;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    white-space: nowrap;
  }
  .badge.muted {
    color: var(--color-muted);
    background: rgba(255, 255, 255, 0.06);
  }
  .status-pill {
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    white-space: nowrap;
  }
  .status-pill.ok {
    color: var(--color-success, #34d399);
    background: color-mix(in srgb, var(--color-success, #34d399) 14%, transparent);
  }
  .status-pill.err {
    color: var(--color-destructive, #f87171);
    background: color-mix(in srgb, var(--color-destructive, #f87171) 14%, transparent);
  }
  .status-pill.warn {
    color: var(--color-warning, #fbbf24);
    background: color-mix(in srgb, var(--color-warning, #fbbf24) 14%, transparent);
  }
  .status-pill.muted {
    color: var(--color-muted);
    background: rgba(255, 255, 255, 0.06);
  }
  .warn-note {
    color: var(--color-warning, #fbbf24);
  }
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius-md, 0.5rem);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
    transition:
      border-color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }
  .action-btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  .action-btn.active {
    color: var(--color-success, #34d399);
    border-color: color-mix(in srgb, var(--color-success, #34d399) 40%, transparent);
    background: color-mix(in srgb, var(--color-success, #34d399) 10%, transparent);
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
