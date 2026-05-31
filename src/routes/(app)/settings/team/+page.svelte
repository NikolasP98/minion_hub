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
    background: rgba(99, 102, 241, 0.06);
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 12px;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: #c7d2fe;
    margin: 0 0 1rem;
  }

  .count-badge {
    background: #6366f1;
    color: white;
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
  }

  .requests {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .request-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
  }

  .req-info { flex: 1; min-width: 0; }

  .req-email {
    font-weight: 600;
    font-size: 0.9rem;
    color: #e0e0f0;
  }

  .req-message {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.5);
    margin: 0.25rem 0;
    line-height: 1.4;
  }

  .req-date {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.3);
  }

  .req-actions {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .btn-approve, .btn-deny {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.75rem;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: opacity 0.2s;
  }

  .btn-approve {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }
  .btn-approve:hover { background: rgba(34, 197, 94, 0.25); }

  .btn-deny {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
  }
  .btn-deny:hover { background: rgba(239, 68, 68, 0.2); }

  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
