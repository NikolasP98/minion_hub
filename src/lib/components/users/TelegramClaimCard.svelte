<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import { MoreVertical, Send, Unlink } from 'lucide-svelte';
  import { Button, Dropdown, Spinner } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import ChannelAccountStateBadge from './ChannelAccountStateBadge.svelte';

  type Identity = {
    id: string;
    source?: 'turso' | 'supabase';
    provider: string;
    kind: 'oauth' | 'channel';
    externalId: string;
    displayName: string | null;
    verifiedAt: number | null;
  };

  let {
    userId,
    identity,
    onUnclaim,
  }: {
    userId: string;
    identity: Identity | null;
    onUnclaim: (identity: Identity) => void;
  } = $props();

  const connected = $derived(!!identity);
  let claimOpen = $state(false);
  const displayName = $derived(identity?.displayName?.trim() || null);
  const showDisplayName = $derived(
    !!displayName && displayName.toLowerCase() !== identity?.externalId.toLowerCase(),
  );

  type Phase = 'idle' | 'starting' | 'awaiting' | 'done' | 'error';
  let phase = $state<Phase>('idle');
  let deepLink = $state<string | null>(null);
  let requestId = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  onDestroy(stopPolling);

  async function poll() {
    if (!requestId) return;
    try {
      const res = await fetch(`/api/users/${userId}/identities/claim/${requestId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { status: string };
      if (data.status === 'done') {
        stopPolling();
        phase = 'done';
        toastSuccess('Telegram connected');
        await invalidate('app:identities');
      } else if (data.status === 'expired') {
        stopPolling();
        phase = 'error';
        errorMsg = 'The link expired. Start again.';
      } else if (data.status === 'taken') {
        stopPolling();
        phase = 'error';
        errorMsg = 'This Telegram account is already connected to another user.';
      }
    } catch {
      /* transient — keep polling */
    }
  }

  async function start() {
    phase = 'starting';
    errorMsg = null;
    try {
      const res = await fetch(`/api/users/${userId}/identities/telegram/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(msg.message ?? `start failed (${res.status})`);
      }
      const data = (await res.json()) as { requestId: string; deepLink: string };
      requestId = data.requestId;
      deepLink = data.deepLink;
      phase = 'awaiting';
      stopPolling();
      pollTimer = setInterval(poll, 2500);
    } catch (e) {
      phase = 'error';
      errorMsg = e instanceof Error ? e.message : 'Could not start';
      toastError(errorMsg);
    }
  }

  function reset() {
    stopPolling();
    phase = 'idle';
    deepLink = null;
    requestId = null;
    errorMsg = null;
  }
</script>

<div>
  <div class="channel-row flex items-center gap-3 px-3 py-2.5">
    <ChannelBrandIcon channel="telegram" class="h-4 w-4 shrink-0" />
    <span class="flex-1 min-w-0">
      <span class="block text-sm text-foreground">Telegram</span>
      <span
        class="flex min-w-0 items-center gap-1.5 text-[length:var(--font-size-label)] text-muted-foreground"
      >
        {#if identity}
          <span class="shrink-0">{identity.externalId}</span>
          {#if showDisplayName}
            <span aria-hidden="true" class="text-muted-strong">·</span>
            <span class="truncate text-foreground">{displayName}</span>
          {/if}
        {:else}
          <span class="truncate">{m.usersui_telegramClaimHint()}</span>
        {/if}
      </span>
    </span>
    {#if connected}
      <ChannelAccountStateBadge state="claimed" />
      <Dropdown
        items={[
          {
            value: 'unclaim',
            label: m.usersui_unclaimIdentity(),
            icon: Unlink,
            danger: true,
          },
        ]}
        onSelect={(value) => {
          if (value === 'unclaim' && identity) onUnclaim(identity);
        }}
        placement="bottom"
      >
        {#snippet trigger()}
          <span
            class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
            aria-label={m.usersui_accountActions()}
          >
            <MoreVertical size={15} />
          </span>
        {/snippet}
      </Dropdown>
    {:else}
      <ChannelAccountStateBadge state="unlinked" />
      <Button
        variant="outline"
        size="xs"
        class="shrink-0"
        aria-expanded={claimOpen}
        aria-controls="telegram-claim-form"
        onclick={() => (claimOpen = !claimOpen)}
      >
        {m.usersui_claimAccount()}
      </Button>
    {/if}
  </div>

  {#if claimOpen && !identity}
    <div id="telegram-claim-form" class="px-3 pb-3 pt-1 space-y-2">
      {#if phase === 'idle'}
        <Button
          variant="primary"
          size="sm"
          class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90"
          onclick={start}
        >
          <Send size={12} /> Connect Telegram
        </Button>
      {:else if phase === 'starting'}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" label={m.common_loading()} />
          Preparing link…
        </div>
      {:else if phase === 'awaiting' && deepLink}
        <a
          href={deepLink}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground no-underline hover:opacity-90"
        >
          <Send size={12} /> Open Telegram
        </a>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner size="xs" label={m.common_loading()} />
          Waiting for you to open the bot and press Start…
        </div>
        <Button
          variant="ghost"
          size="xs"
          class="text-[length:var(--font-size-label)] text-muted hover:text-foreground bg-transparent border-none cursor-pointer"
          onclick={reset}
        >
          Cancel
        </Button>
      {:else if phase === 'done'}
        <div class="flex items-center gap-2 text-sm text-success">
          <span class="w-2 h-2 rounded-full bg-success"></span> Telegram connected
        </div>
      {:else if phase === 'error'}
        <div class="text-sm text-destructive">{errorMsg}</div>
        <Button
          variant="ghost"
          size="xs"
          class="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer"
          onclick={start}
        >
          Try again
        </Button>
      {/if}
    </div>
  {/if}
</div>
