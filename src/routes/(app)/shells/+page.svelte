<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { onMount } from 'svelte';
  import { goto } from '$lib/navigation';
  import {
    listShells,
    getQuota,
    type ShellSummary,
    type ShellsQuota,
    type ShellsProvisionResponse,
  } from '$lib/services/shells-rpc';
  import QuotaStrip from '$lib/components/shells/QuotaStrip.svelte';
  import ShellRow from '$lib/components/shells/ShellRow.svelte';
  import ProvisionForm from '$lib/components/shells/ProvisionForm.svelte';
  import { Button, PageHeader } from '$lib/components/ui';
  import {
    AsyncBoundary,
    PageBody,
    PageShell,
    type AsyncBoundaryState,
  } from '$lib/components/ui/foundations';
  import { Terminal } from 'lucide-svelte';

  let shells = $state<ShellSummary[]>([]);
  let quota = $state<ShellsQuota | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showProvision = $state(false);

  async function refresh(): Promise<void> {
    try {
      const [s, q] = await Promise.all([listShells(), getQuota()]);
      shells = s;
      quota = q;
      loading = false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  });

  function onProvisioned(res: ShellsProvisionResponse): void {
    showProvision = false;
    void refresh();
    // Could navigate to the new shell's detail page once it's online.
    void goto(`/shells/${res.shellId}`);
  }

  const pageState = $derived.by<AsyncBoundaryState>(() => {
    if (error) {
      return { kind: 'error', description: error, retry: () => void refresh() };
    }
    if (loading) return { kind: 'loading', label: m.common_loading() };
    if (shells.length === 0 && !showProvision) {
      return {
        kind: 'empty',
        title: m.shellsPage_empty(),
        description: m.shellsPage_emptyDescription(),
      };
    }
    return { kind: 'ready' };
  });
</script>

<PageShell archetype="collection" scroll="none" labelledBy="shells-title">
<PageHeader
  titleId="shells-title"
  title={m.shellsPage_title()}
  subtitle={m.shellsPage_subtitle()}
>
  {#snippet leading()}
    <Terminal size={16} class="text-accent shrink-0" />
  {/snippet}
  {#snippet primaryActions()}
    <Button variant="primary" size="sm" onclick={() => (showProvision = !showProvision)}>
      {showProvision ? m.common_cancel() : m.shellsPage_spinupButton()}
    </Button>
  {/snippet}
</PageHeader>
<PageBody padding="none" scroll="region">
  <QuotaStrip {quota} />

  <AsyncBoundary state={pageState}>
    {#snippet emptyAction()}
      <Button variant="primary" size="sm" onclick={() => (showProvision = true)}>
        {m.shellsPage_spinupButton()}
      </Button>
    {/snippet}
    {#if showProvision}
      <div class="panel">
        <ProvisionForm {onProvisioned} />
      </div>
    {/if}

    {#if shells.length > 0}
    <div class="list" data-component="shells-list">
      <div class="list-header">
        <span></span>
        <span>{m.shellsPage_name()}</span>
        <span>{m.shellsPage_harness()}</span>
        <span>{m.shellsPage_region()}</span>
        <span>{m.shellsPage_resources()}</span>
        <span>{m.shellsPage_lastInvoke()}</span>
        <span style="text-align:right">{m.shellsPage_status()}</span>
      </div>
      {#each shells as shell (shell.shellId)}
        <ShellRow {shell} onSelect={(id) => goto(`/shells/${id}`)} />
      {/each}
    </div>
    {/if}
  </AsyncBoundary>
</PageBody>
</PageShell>

<style>
  .panel {
    border-bottom: 1px solid var(--color-border-default, var(--color-border));
    background: var(--color-surface-1, var(--color-bg2));
  }
  .list-header {
    display: grid;
    grid-template-columns: auto 1fr 120px 80px 130px 110px 100px;
    gap: var(--space-3, 12px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border-bottom: 1px solid var(--color-border-default, var(--color-border));
    font-size: var(--font-size-label, 12px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-weight: 600;
    background: var(--color-surface-1, var(--color-bg2));
  }
  @media (max-width: 767.98px) {
    .list-header {
      display: none;
    }
    .list {
      padding: var(--space-2, 8px) var(--space-page-gutter, 16px);
    }
  }
</style>
