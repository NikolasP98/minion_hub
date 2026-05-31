<script lang="ts">
  import TeamTab from '$lib/components/users/TeamTab.svelte';
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { notificationState } from '$lib/state/features/notifications.svelte';
  import { X, Check } from 'lucide-svelte';

  let { data }: { data: PageData } = $props();

  let reviewing = $state<string | null>(null);

  async function review(id: string, status: 'approved' | 'denied') {
    reviewing = id;
    try {
      const res = await fetch(`/api/join-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        await invalidate('settings:team');
        notificationState.refresh();
      }
    } finally {
      reviewing = null;
    }
  }
</script>

{#if data.pendingRequests.length > 0}
  <div class="pending-section">
    <h2 class="section-title">
      Pending Access Requests
      <span class="count-badge">{data.pendingRequests.length}</span>
    </h2>
    <div class="requests">
      {#each data.pendingRequests as req (req.id)}
        <div class="request-card">
          <div class="req-info">
            <span class="req-email">{req.email}</span>
            {#if req.message}
              <p class="req-message">{req.message}</p>
            {/if}
            <span class="req-date">Requested {new Date(req.createdAt).toLocaleDateString()}</span>
          </div>
          <div class="req-actions">
            <button
              class="btn-approve"
              disabled={reviewing === req.id}
              onclick={() => review(req.id, 'approved')}
              title="Approve"
            >
              <Check size={16} /> Approve
            </button>
            <button
              class="btn-deny"
              disabled={reviewing === req.id}
              onclick={() => review(req.id, 'denied')}
              title="Deny"
            >
              <X size={16} /> Deny
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<TeamTab initialUsers={data.users} initialCustomRoles={data.customRoles} />

<style>
  .pending-section {
    margin-bottom: 2rem;
    padding: 1.25rem;
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
    border-radius: var(--radius-xl);
    backdrop-filter: blur(12px);
  }

  .section-title {
    display: flex; align-items: center; gap: 0.5rem;
    font-size: 0.95rem; font-weight: 600;
    color: var(--color-purple);
    margin: 0 0 1rem;
  }

  .count-badge {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
    font-size: 0.7rem; padding: 0.1rem 0.45rem;
    border-radius: var(--radius-full);
  }

  .requests { display: flex; flex-direction: column; gap: 0.75rem; }

  .request-card {
    display: flex; justify-content: space-between; align-items: center;
    gap: 1rem; padding: 0.85rem 1rem;
    background: var(--color-bg3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }

  .req-info { flex: 1; min-width: 0; }
  .req-email { font-weight: 600; font-size: 0.9rem; color: var(--color-foreground); }
  .req-message { font-size: 0.8rem; color: var(--color-muted); margin: 0.25rem 0; line-height: 1.4; }
  .req-date { font-size: 0.7rem; color: var(--color-muted-foreground); }
  .req-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }

  .btn-approve, .btn-deny {
    display: flex; align-items: center; gap: 0.3rem;
    padding: 0.4rem 0.75rem; border-radius: var(--radius-lg);
    font-size: 0.8rem; font-weight: 500; cursor: pointer; border: none;
    transition: background var(--duration-fast);
  }

  .btn-approve {
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    color: var(--color-success);
  }
  .btn-approve:hover { background: color-mix(in srgb, var(--color-success) 25%, transparent); }

  .btn-deny {
    background: color-mix(in srgb, var(--color-destructive) 10%, transparent);
    color: var(--color-destructive);
  }
  .btn-deny:hover { background: color-mix(in srgb, var(--color-destructive) 20%, transparent); }

  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
