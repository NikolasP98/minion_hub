<script lang="ts">
  import type { PageData } from './$types';
  import { goto } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { ArrowLeftRight, Plus, X } from 'lucide-svelte';
  import { PageHeader, Button, Badge } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { entryStatusVariant } from '$lib/components/stock/stock-ui';

  let { data }: { data: PageData } = $props();
  const entries = $derived(data.entries);

  let statusFilter = $state('');
  let typeFilter = $state('');

  const view = $derived(
    entries.filter((e) => (!statusFilter || e.status === statusFilter) && (!typeFilter || e.type === typeFilter)),
  );

  const statusLabel = (s: string) => (s === 'draft' ? m.stock_status_draft() : s === 'submitted' ? m.stock_status_submitted() : m.stock_status_cancelled());
  const typeLabel = (t: string) =>
    t === 'receipt' ? m.stock_type_receipt() : t === 'issue' ? m.stock_type_issue() : t === 'transfer' ? m.stock_type_transfer() : m.stock_type_adjustment();
</script>

<svelte:head><title>{m.stock_entries_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.stock_entries_title()} subtitle={m.stock_entries_subtitle()}>
    {#snippet leading()}<ArrowLeftRight size={16} class="text-accent shrink-0" />{/snippet}
    {#snippet actions()}
      <Button
        variant="primary"
        size="sm"
        onclick={() => goto('/stock/entries/new')}
        disabled={!canAct('stock', 'create')}
        title={canAct('stock', 'create') ? undefined : m.no_permission()}
      >
        <Plus size={14} /> {m.stock_new_entry()}
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--hairline)]">
    <select bind:value={statusFilter} class="sel">
      <option value="">{m.stock_filter_all_status()}</option>
      <option value="draft">{m.stock_status_draft()}</option>
      <option value="submitted">{m.stock_status_submitted()}</option>
      <option value="cancelled">{m.stock_status_cancelled()}</option>
    </select>
    <select bind:value={typeFilter} class="sel">
      <option value="">{m.stock_filter_all_type()}</option>
      <option value="receipt">{m.stock_type_receipt()}</option>
      <option value="issue">{m.stock_type_issue()}</option>
      <option value="transfer">{m.stock_type_transfer()}</option>
      <option value="adjustment">{m.stock_type_adjustment()}</option>
    </select>
    {#if data.partyFilter}
      <button class="chip" onclick={() => goto('/stock/entries')}>
        {m.stock_col_party()}: {data.entries[0]?.partyName ?? data.partyFilter} <X size={11} />
      </button>
    {/if}
  </div>

  <div class="flex-1 min-h-0 overflow-auto">
    {#if view.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <ArrowLeftRight size={32} class="text-muted-foreground" />
        <p class="t-caption">{m.stock_entries_empty()}</p>
      </div>
    {:else}
      <table class="w-full text-sm border-collapse">
        <thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
          <tr class="text-left t-caption border-b border-[var(--hairline)]">
            <th class="px-4 py-2 font-medium">{m.stock_col_id()}</th>
            <th class="px-3 py-2 font-medium">{m.stock_col_type()}</th>
            <th class="px-3 py-2 font-medium">{m.stock_col_status()}</th>
            <th class="px-3 py-2 font-medium">{m.stock_col_party()}</th>
            <th class="px-4 py-2 font-medium text-right">{m.stock_col_created()}</th>
          </tr>
        </thead>
        <tbody>
          {#each view as e (e.id)}
            {@const sv = entryStatusVariant(e.status)}
            <tr class="border-b border-[var(--hairline)] hover:bg-white/[0.03] cursor-pointer" onclick={() => goto(`/stock/entries/${e.id}`)}>
              <td class="px-4 py-2 font-mono text-xs">{e.humanId ?? e.id.slice(0, 8)}</td>
              <td class="px-3 py-2">{typeLabel(e.type)}</td>
              <td class="px-3 py-2">
                <Badge variant={sv.variant} value={sv.value}>{statusLabel(e.status)}</Badge>
              </td>
              <td class="px-3 py-2 t-caption">{e.partyName ?? '—'}</td>
              <td class="px-4 py-2 text-right t-caption">{new Date(e.createdAt).toLocaleDateString()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .sel { height: 2rem; padding: 0 0.5rem; font-size: 0.82rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); }
  .chip { display: inline-flex; align-items: center; gap: 0.3rem; height: 1.8rem; padding: 0 0.6rem; font-size: 0.76rem; border-radius: 999px; border: 1px solid var(--color-accent); color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); cursor: pointer; }
</style>
