<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { refreshNotifications } from '$lib/state/features/notifications.svelte';
  import { toastPromise } from '$lib/state/ui/toast.svelte';
  import { Bell, Check, X } from 'lucide-svelte';
  import PageHeader from '$lib/components/ui/PageHeader.svelte';

  let { data }: { data: PageData } = $props();

  let reviewing = $state<string | null>(null);

  async function review(id: string, status: 'approved' | 'denied') {
    reviewing = id;
    try {
      await toastPromise(
        fetch(`/api/join-requests/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
          await invalidate('app:notifications');
          refreshNotifications();
        }),
        {
          loading: status === 'approved' ? 'Approving request…' : 'Denying request…',
          success: status === 'approved' ? 'Request approved' : 'Request denied',
          error: (err: unknown) => err instanceof Error ? err.message : 'Failed to process request',
        },
      );
    } finally {
      reviewing = null;
    }
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

<div class="p-6">
  <PageHeader title="Notifications" />

  {#if data.requests.length === 0}
    <div class="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <Bell size={32} class="opacity-30" />
      <p class="text-sm">No pending notifications</p>
    </div>
  {:else}
    <div class="space-y-2 mt-4">
      {#each data.requests as req (req.id)}
        <div
          class="flex items-start justify-between gap-4 p-4 rounded-xl border border-border bg-bg2/50 hover:bg-bg2 transition-colors duration-100"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-0.5">
              <span class="text-sm font-semibold text-foreground">{req.email}</span>
              <span class="text-[10px] text-muted-foreground">{timeAgo(req.createdAt)}</span>
            </div>
            {#if req.message}
              <p class="text-xs text-muted mt-1">{req.message}</p>
            {/if}
            <span class="inline-block text-[10px] font-medium text-accent mt-2 px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20">
              Access request pending
            </span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-success/10 text-success border border-success/20 hover:bg-success/15 transition-colors duration-150 disabled:opacity-50"
              disabled={reviewing === req.id}
              onclick={() => review(req.id, 'approved')}
              title="Approve"
            >
              <Check size={14} />
              Approve
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15 transition-colors duration-150 disabled:opacity-50"
              disabled={reviewing === req.id}
              onclick={() => review(req.id, 'denied')}
              title="Deny"
            >
              <X size={14} />
              Deny
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>