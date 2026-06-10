<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import { Send } from 'lucide-svelte';

  let { userId, claimed }: { userId: string; claimed: boolean } = $props();

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
        toastSuccess('Telegram claimed');
        await invalidate('app:identities');
      } else if (data.status === 'expired') {
        stopPolling();
        phase = 'error';
        errorMsg = 'The link expired. Start again.';
      } else if (data.status === 'taken') {
        stopPolling();
        phase = 'error';
        errorMsg = 'This Telegram account is already claimed by another user.';
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

<div class="border border-border rounded-md overflow-hidden">
  <div class="flex items-center gap-2 px-3 py-2 bg-bg/40">
    <ChannelBrandIcon channel="telegram" class="h-4 w-4" />
    <span class="flex-1 min-w-0">
      <span class="block text-sm text-foreground">Telegram {claimed ? '(claimed)' : ''}</span>
      <span class="block text-[11px] text-muted-foreground">Open a one-tap link — the bot confirms it's you. No code to type.</span>
    </span>
  </div>

  <div class="px-3 py-3 border-t border-border space-y-2">
    {#if phase === 'idle' || (phase === 'done' && claimed)}
      <button
        class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90"
        onclick={start}
      >
        <Send size={12} /> {claimed ? 'Re-claim Telegram' : 'Claim Telegram'}
      </button>
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
      <button class="text-[11px] text-muted hover:text-foreground bg-transparent border-none cursor-pointer" onclick={reset}>
        Cancel
      </button>
    {:else if phase === 'done'}
      <div class="flex items-center gap-2 text-sm text-green-400">
        <span class="w-2 h-2 rounded-full bg-green-400"></span> Telegram claimed
      </div>
    {:else if phase === 'error'}
      <div class="text-sm text-destructive">{errorMsg}</div>
      <button class="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer" onclick={start}>
        Try again
      </button>
    {/if}
  </div>
</div>
