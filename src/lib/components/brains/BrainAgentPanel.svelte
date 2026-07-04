<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { Bot } from 'lucide-svelte';
  import { Badge, Button, Card } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let { brainId, agentId, canManage }: { brainId: string; agentId: string | null; canManage: boolean } =
    $props();

  let busy = $state(false);
  let error = $state('');

  async function enable() {
    busy = true;
    error = '';
    try {
      const res = await fetch(`/api/brains/${encodeURIComponent(brainId)}/agent`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = (body as { message?: string }).message ?? m.brains_agent_error_generic();
        return;
      }
      await invalidate('brains:detail');
    } finally {
      busy = false;
    }
  }

  async function disable() {
    if (!confirm(m.brains_agent_confirm_disable())) return;
    busy = true;
    error = '';
    try {
      const res = await fetch(`/api/brains/${encodeURIComponent(brainId)}/agent`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = (body as { message?: string }).message ?? m.brains_agent_error_generic();
        return;
      }
      await invalidate('brains:detail');
    } finally {
      busy = false;
    }
  }
</script>

<Card padding="lg" class="max-w-xl">
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <div class="grid size-9 shrink-0 place-items-center rounded-lg bg-white/5 text-accent">
        <Bot size={18} />
      </div>
      <div class="min-w-0 flex-1">
        <h2 class="text-sm font-semibold text-foreground">{m.brains_agent_panel_title()}</h2>
        {#if agentId}
          <Badge variant="semantic" value="success" size="sm">{m.brains_agent_status_active()}</Badge>
        {:else}
          <Badge variant="neutral" size="sm">{m.brains_agent_status_none()}</Badge>
        {/if}
      </div>
    </div>

    <p class="text-sm text-[var(--color-muted-foreground)]">{m.brains_agent_panel_desc()}</p>

    {#if agentId}
      <p class="t-caption">{m.brains_agent_id_label()}: <code class="text-foreground/80">{agentId}</code></p>
    {/if}

    <p class="t-caption">
      <a href="/brains/template" class="text-accent hover:underline">{m.brains_agent_panel_template_link()}</a>
    </p>

    {#if error}
      <p class="text-xs text-destructive">{error}</p>
    {/if}

    {#if canManage}
      <div class="flex justify-start">
        {#if agentId}
          <Button variant="danger" size="sm" loading={busy} onclick={disable}>{m.brains_agent_disable()}</Button>
        {:else}
          <Button variant="primary" size="sm" loading={busy} onclick={enable}>{m.brains_agent_enable()}</Button>
        {/if}
      </div>
    {/if}
  </div>
</Card>
