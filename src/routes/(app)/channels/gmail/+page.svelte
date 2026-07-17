<script lang="ts">
  import { Badge, Button } from '$lib/components/ui';
  import { invalidate, goto } from '$lib/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { Building2, RefreshCw, Check, Plus } from 'lucide-svelte';
  import { PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { supabaseBrowser } from '$lib/supabase/client';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import type { GmailAccountRow, LedgerRow } from './+page.server';

  let { data }: { data: PageData } = $props();
  const accounts = $derived(data.accounts as GmailAccountRow[]);
  const ledger = $derived(data.ledger as LedgerRow[]);

  let busy = $state<string | null>(null);

  // Retention (days) is seeded once from the server; edits are user-driven.
  // svelte-ignore state_referenced_locally
  let retention = $state<number>(data.retentionDays);
  let savingRetention = $state(false);
  async function saveRetention() {
    savingRetention = true;
    try {
      const res = await fetch('/api/email-ledger/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retentionDays: retention }),
      });
      if (!res.ok) throw new Error(await res.text());
      retention = (await res.json()).retentionDays;
      toastSuccess(m.gmailch_retentionSaved());
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      savingRetention = false;
    }
  }

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Health pill per row. `health.ok && hasGmail` is the only green state —
  // a valid token WITHOUT the Gmail scope is precisely the silent failure this
  // page exists to surface (account linked before Gmail scopes were requested).
  function healthPill(a: GmailAccountRow): {
    label: string;
    value: 'success' | 'warning' | 'error' | 'info';
  } {
    if (!a.health) return { label: m.gmailch_healthUnknown(), value: 'info' };
    if (!a.health.ok) {
      return a.health.reason === 'revoked'
        ? { label: m.gmailch_healthRevoked(), value: 'error' }
        : { label: m.gmailch_healthUnreachable(), value: 'info' };
    }
    if (!a.health.hasGmail) return { label: m.gmailch_healthNoGmail(), value: 'warning' };
    return { label: m.gmailch_healthOk(), value: 'success' };
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

<PageShell archetype="collection" scroll="page" labelledBy="gmail-channel-title">
  <PageHeader titleId="gmail-channel-title" title="Gmail" subtitle={m.gmailch_subtitle()}>
    {#snippet leading()}
      <ChannelBrandIcon channel="gmail" size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <PageBody width="content">
    <AsyncBoundary
      state={accounts.length === 0
        ? { kind: 'empty', title: m.gmailch_empty() }
        : { kind: 'ready' }}
    >
      {#snippet emptyAction()}
        <Button variant="primary" size="sm" onclick={reconnectGoogle}>
          <Plus size={14} />{m.gmailch_connect()}
        </Button>
      {/snippet}
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
                  <Badge variant="semantic" value="accent" size="sm">
                    <Building2 size={10} />{m.gmailch_sharedBadge()}
                  </Badge>
                {:else}
                  <Badge variant="neutral" size="sm">{m.gmailch_ownBadge()}</Badge>
                {/if}
                <Badge variant="semantic" value={pill.value} size="sm">{pill.label}</Badge>
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
                <Button
                  variant={a.subscribed ? 'secondary' : 'outline'}
                  size="sm"
                  class={a.subscribed ? 'active' : ''}
                  disabled={busy === a.identityId}
                  onclick={() => toggleFeed(a)}
                >
                  {#if a.subscribed}<Check size={14} />{m.gmailch_inFeed()}{:else}<Plus
                      size={14}
                    />{m.gmailch_addToFeed()}{/if}
                </Button>
              {:else}
                <Button variant="outline" size="sm" onclick={reconnectGoogle}>
                  <RefreshCw size={14} />{m.gmailch_reconnect()}
                </Button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <p class="text-xs text-muted-foreground mt-4 max-w-xl">{m.gmailch_footnote()}</p>
    </AsyncBoundary>

    <!-- Processed-email ledger: summaries + tags + metadata, never contents. -->
    <section class="ledger">
      <div class="ledger-head">
        <div class="min-w-0">
          <h2 class="ledger-title">{m.gmailch_ledgerTitle()}</h2>
          <p class="ledger-sub">{m.gmailch_ledgerSubtitle()}</p>
        </div>
        <div class="retention">
          <label for="retention-days">{m.gmailch_retentionLabel()}</label>
          <input
            id="retention-days"
            type="number"
            min="0"
            max="3650"
            bind:value={retention}
            class="retention-input"
          />
          <Button
            variant="primary"
            size="sm"
            onclick={saveRetention}
            disabled={savingRetention}
          >
            {m.gmailch_save()}
          </Button>
        </div>
      </div>
      <p class="retention-hint">{m.gmailch_retentionHint()}</p>

      {#if ledger.length === 0}
        <p class="ledger-empty">{m.gmailch_ledgerEmpty()}</p>
      {:else}
        <ul class="ledger-list">
          {#each ledger as row (row.id)}
            <li class="ledger-row">
              <div class="ledger-row-top">
                <span class="ledger-subject">{row.subject || m.gmailch_ledgerNoSubject()}</span>
                {#each row.labels as label (label)}<span class="tag">{label}</span>{/each}
              </div>
              {#if row.summary}<p class="ledger-summary">{row.summary}</p>{/if}
              <p class="ledger-meta">
                {#if row.fromDomain}{row.fromDomain} · {/if}{row.mailbox} · {dateFmt(
                  row.processedAt,
                )}
              </p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </PageBody>
</PageShell>

<style>
  .account-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
    max-width: 46rem;
  }
  .account-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4, 1rem);
    padding: var(--space-4, 1rem);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-2);
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
  .warn-note {
    color: var(--color-warning-fg);
  }

  /* ── Processed-email ledger ─────────────────────────────────────────── */
  .ledger {
    max-width: 46rem;
    margin-top: var(--space-8, 2rem);
    padding-top: var(--space-6, 1.5rem);
    border-top: 1px solid var(--color-border-subtle);
  }
  .ledger-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4, 1rem);
    flex-wrap: wrap;
  }
  .ledger-title {
    font-size: var(--font-size-section-title, 0.9375rem);
    font-weight: 600;
    color: var(--color-foreground);
  }
  .ledger-sub {
    font-size: var(--font-size-caption, 0.75rem);
    color: var(--color-muted-foreground, var(--color-muted));
    margin-top: var(--space-0-5, 0.125rem);
  }
  .retention {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    font-size: var(--font-size-caption, 0.75rem);
    color: var(--color-muted-foreground, var(--color-muted));
    flex-shrink: 0;
  }
  .retention-input {
    width: 4.5rem;
    padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-foreground);
    font-size: var(--font-size-body, 0.8125rem);
    font-variant-numeric: tabular-nums;
  }
  .retention-hint {
    font-size: var(--font-size-label, 0.6875rem);
    color: var(--color-muted-foreground, var(--color-muted));
    margin-top: var(--space-2, 0.5rem);
    max-width: 34rem;
  }
  .ledger-empty {
    font-size: var(--font-size-body, 0.8125rem);
    color: var(--color-muted-foreground, var(--color-muted));
    margin-top: var(--space-card);
    padding: var(--space-card);
    text-align: center;
    border: 1px dashed var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  .ledger-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
    margin-top: var(--space-4, 1rem);
  }
  .ledger-row {
    padding: var(--space-3, 0.75rem);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-2);
  }
  .ledger-row-top {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    flex-wrap: wrap;
  }
  .ledger-subject {
    font-size: var(--font-size-body, 0.8125rem);
    font-weight: 500;
    color: var(--color-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .ledger-summary {
    font-size: var(--font-size-caption, 0.75rem);
    color: color-mix(in srgb, var(--color-foreground) 62%, transparent);
    margin-top: var(--space-0-5, 0.125rem);
  }
  .ledger-meta {
    font-size: var(--font-size-label, 0.6875rem);
    color: var(--color-muted-foreground, var(--color-muted));
    margin-top: var(--space-1, 0.25rem);
    font-variant-numeric: tabular-nums;
  }
  .tag {
    flex-shrink: 0;
    font-size: var(--font-size-caption, 10px);
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 1px var(--space-2);
    border-radius: var(--radius-md);
    color: color-mix(in srgb, var(--color-foreground) 62%, transparent);
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
    white-space: nowrap;
  }
</style>
