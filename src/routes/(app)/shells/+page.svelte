<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
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
</script>

<div class="page">
  <header>
    <div class="title">
      <h1>Shells</h1>
      <p>Long-lived exe.dev VMs, each hosting one autonomous agent with full admin.</p>
    </div>
    <button class="primary" onclick={() => (showProvision = !showProvision)}>
      {showProvision ? 'Cancel' : '+ Spin up shell'}
    </button>
  </header>

  <QuotaStrip {quota} />

  {#if showProvision}
    <div class="panel">
      <ProvisionForm {onProvisioned} />
    </div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {:else if loading}
    <div class="empty">Loading…</div>
  {:else if shells.length === 0}
    <div class="empty">
      <h2>No shells yet</h2>
      <p>Spin one up to get started. Each shell gets its own exe.dev VM.</p>
    </div>
  {:else}
    <div class="list">
      <div class="list-header">
        <span></span>
        <span>Name</span>
        <span>Harness</span>
        <span>Region</span>
        <span>Resources</span>
        <span>Last invoke</span>
        <span style="text-align:right">Status</span>
      </div>
      {#each shells as shell (shell.shellId)}
        <ShellRow {shell} onSelect={(id) => goto(`/shells/${id}`)} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 24px 16px 16px;
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }
  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
  }
  .title p {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--color-text-muted, #6b7280);
  }
  .primary {
    padding: 8px 14px;
    background: rgb(15, 23, 42);
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
  }
  .panel {
    border-bottom: 1px solid var(--color-border, #e5e7eb);
    background: var(--color-surface-soft, #fafafa);
  }
  .list-header {
    display: grid;
    grid-template-columns: auto 1fr 120px 80px 130px 110px 100px;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--color-border, #e5e7eb);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted, #6b7280);
    font-weight: 600;
    background: var(--color-surface-soft, #fafafa);
  }
  .empty, .error {
    padding: 48px 24px;
    text-align: center;
    color: var(--color-text-muted, #6b7280);
  }
  .empty h2 {
    margin: 0 0 8px;
    font-size: 16px;
    color: inherit;
  }
  .error {
    color: rgb(185, 28, 28);
  }
</style>
