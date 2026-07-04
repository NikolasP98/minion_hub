<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { Bot } from 'lucide-svelte';
  import { Badge, Button } from '$lib/components/ui';
  import { PageHeader, EmptyState } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();

  const canManage = $derived(canAct('brains', 'manage'));
  let busyId = $state<string | null>(null);

  async function toggle(brainId: string, hasAgent: boolean) {
    if (hasAgent && !confirm(m.brains_agent_confirm_disable())) return;
    busyId = brainId;
    try {
      await fetch(`/api/brains/${encodeURIComponent(brainId)}/agent`, { method: hasAgent ? 'DELETE' : 'POST' });
      await invalidate('brains:list');
    } finally {
      busyId = null;
    }
  }
</script>

<svelte:head><title>{m.brains_nav_agents()} · {m.nav_brains()}</title></svelte:head>

<div class="flex h-full flex-col overflow-hidden">
  <PageHeader title={m.brains_nav_agents()} subtitle={m.brains_agents_page_subtitle()}>
    {#snippet leading()}
      <Bot size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-y-auto p-6">
    {#if data.brains.length === 0}
      <EmptyState title={m.brains_empty_title()} description={m.brains_empty_desc()} icon={Bot} />
    {:else}
      <div class="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--hairline)]">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--hairline)] text-left text-xs text-muted">
              <th class="px-3 py-2 font-medium">{m.brains_doc_title()}</th>
              <th class="px-3 py-2 font-medium">{m.brains_agents_col_status()}</th>
              <th class="px-3 py-2 font-medium">{m.brains_agents_col_agent()}</th>
              {#if canManage}<th class="px-3 py-2 font-medium"></th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each data.brains as brain (brain.id)}
              <tr class="border-b border-[var(--hairline)] last:border-0">
                <td class="px-3 py-2">
                  <a href={`/brains/${brain.id}`} class="text-accent hover:underline">{brain.name}</a>
                </td>
                <td class="px-3 py-2">
                  {#if brain.agentId}
                    <Badge variant="semantic" value="success" size="sm">{m.brains_agent_status_active()}</Badge>
                  {:else}
                    <Badge variant="neutral" size="sm">{m.brains_agent_status_none()}</Badge>
                  {/if}
                </td>
                <td class="px-3 py-2 text-muted">{brain.agentId ?? '—'}</td>
                {#if canManage}
                  <td class="px-3 py-2 text-right">
                    {#if brain.agentId}
                      <Button variant="danger" size="sm" loading={busyId === brain.id} onclick={() => toggle(brain.id, true)}>
                        {m.brains_agent_disable()}
                      </Button>
                    {:else}
                      <Button variant="primary" size="sm" loading={busyId === brain.id} onclick={() => toggle(brain.id, false)}>
                        {m.brains_agent_enable()}
                      </Button>
                    {/if}
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="mt-4 text-xs text-muted">
        <a href="/agents?archetype=brain" class="text-accent hover:underline">{m.brains_agents_view_roster()}</a>
      </p>
    {/if}
  </div>
</div>
