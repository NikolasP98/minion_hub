<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import { Check, ChevronDown, Send } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';

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
    onDisconnect,
  }: {
    userId: string;
    identity: Identity | null;
    onDisconnect: (identity: Identity) => void;
  } = $props();

  const connected = $derived(!!identity);

  let open = $state(false);

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
  <Button variant="ghost" size="xs"
    class="w-full flex items-center gap-3 px-3 py-2.5 bg-transparent border-none cursor-pointer text-left hover:bg-bg3/30 transition-colors"
    onclick={() => (open = !open)}
  >
    <ChannelBrandIcon channel="telegram" class="h-4 w-4 shrink-0" />
    <span class="flex-1 min-w-0">
      <span class="block text-sm text-foreground">Telegram</span>
      <span class="block text-[length:var(--font-size-label)] text-muted-foreground truncate">
        {connected ? (identity?.displayName ?? identity?.externalId ?? 'Connected') : 'One-tap link — the bot confirms it’s you'}
      </span>
    </span>
    {#if connected}
      <span class="inline-flex items-center gap-1 text-[length:var(--font-size-telemetry)] font-medium px-1.5 py-0.5 rounded-full bg-success/15 text-success border border-success/20 shrink-0">
        <Check size={10} /> Connected
      </span>
    {:else}
      <span class="text-[length:var(--font-size-label)] text-muted-foreground shrink-0">Connect</span>
    {/if}
    <ChevronDown size={14} class="text-muted shrink-0 transition-transform {open ? 'rotate-180' : ''}" />
  </Button>

  {#if open}
    <div class="px-3 pb-3 pt-1 space-y-2">
      {#if connected}
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-muted-foreground">
            Connected as <span class="text-foreground">{identity?.displayName ?? identity?.externalId}</span>
          </span>
          {#if identity}
            <Button variant="ghost" size="xs"
              class="text-[length:var(--font-size-label)] text-muted hover:text-destructive bg-transparent border-none cursor-pointer"
              onclick={() => onDisconnect(identity!)}
            >
              Disconnect
            </Button>
          {/if}
        </div>
      {:else if phase === 'idle'}
        <Button variant="primary" size="sm"
          class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90"
          onclick={start}
        >
          <Send size={12} /> Connect Telegram
        </Button>
      {:else if phase === 'starting'}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
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
          <div class="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
          Waiting for you to open the bot and press Start…
        </div>
        <Button variant="ghost" size="xs" class="text-[length:var(--font-size-label)] text-muted hover:text-foreground bg-transparent border-none cursor-pointer" onclick={reset}>
          Cancel
        </Button>
      {:else if phase === 'done'}
        <div class="flex items-center gap-2 text-sm text-success">
          <span class="w-2 h-2 rounded-full bg-success"></span> Telegram connected
        </div>
      {:else if phase === 'error'}
        <div class="text-sm text-destructive">{errorMsg}</div>
        <Button variant="ghost" size="xs" class="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer" onclick={start}>
          Try again
        </Button>
      {/if}
    </div>
  {/if}
</div>
