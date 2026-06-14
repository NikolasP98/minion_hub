<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Bell, ArrowRight } from 'lucide-svelte';
  import { scale } from 'svelte/transition';

  interface PendingRequest {
    id: string;
    email: string;
    message: string | null;
    createdAt: number;
  }

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let requests = $state<PendingRequest[]>([]);
  let loading = $state(false);

  async function fetchRequests() {
    loading = true;
    try {
      const res = await fetch('/api/join-requests/pending');
      if (res.ok) {
        const data = await res.json();
        requests = data.requests ?? [];
      }
    } catch {
      // silent
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) fetchRequests();
  });

  function close() {
    open = false;
  }

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
</script>

{#if open}
  <button
    class="fixed inset-0 z-40 cursor-default"
    onclick={close}
    aria-label={m.common_close()}
    tabindex="-1"
  ></button>

  <div
    class="absolute right-0 top-full mt-1.5 z-50 w-80 bg-bg2 border border-border rounded-xl shadow-xl overflow-hidden"
    transition:scale={{ duration: 150, start: 0.95 }}
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--hairline)]">
      <h3 class="text-sm font-semibold text-foreground">{m.notificationsPopup_title()}</h3>
      {#if requests.length > 0}
        <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent/15 text-accent">
          {requests.length}
        </span>
      {/if}
    </div>

    <!-- List -->
    <div class="max-h-72 overflow-y-auto">
      {#if loading}
        <div class="flex items-center justify-center py-8">
          <div class="w-5 h-5 border-2 border-muted-foreground/30 border-t-accent rounded-full animate-spin"></div>
        </div>
      {:else if requests.length === 0}
        <div class="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
          <Bell size={24} class="opacity-40" />
          <p class="text-xs">{m.notificationsPopup_noPending()}</p>
        </div>
      {:else}
        {#each requests as req (req.id)}
          <div class="flex flex-col px-4 py-3 border-b border-[var(--hairline)] last:border-b-0 hover:bg-bg3/50 transition-colors duration-100">
            <div class="flex items-start justify-between gap-2">
              <span class="text-sm font-medium text-foreground truncate">{req.email}</span>
              <span class="text-[10px] text-muted-foreground shrink-0">{timeAgo(req.createdAt)}</span>
            </div>
            {#if req.message}
              <p class="text-xs text-muted mt-0.5 line-clamp-2">{req.message}</p>
            {/if}
            <span class="text-[10px] text-accent mt-1 font-medium">{m.notificationsPopup_pending()}</span>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Footer -->
    <a
      href="/notifications"
      onclick={close}
      class="flex items-center justify-center gap-1.5 px-4 py-2.5 border-t border-[var(--hairline)] text-xs font-medium text-accent hover:bg-bg3 transition-colors duration-100 no-underline"
    >
      {m.notificationsPopup_seeAll()}
      <ArrowRight size={12} />
    </a>
  </div>
{/if}

<style>
  .animate-spin {
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* tailwind line-clamp fallback */
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
