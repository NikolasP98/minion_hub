<script lang="ts">
  /** Ranked list block (spec 049): one labelled bar per category, largest first. */
  import { ProgressBar } from '$lib/components/ui';
  import { formatValue, toNumber } from '$lib/sandbox/blocks/format';
  import { VALUE } from '$lib/sandbox/blocks/query';
  import type { ListSpec } from '$lib/sandbox/blocks/schema';
  import type { QueryResult } from '../BlockView.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    spec: ListSpec;
    rows: QueryResult;
  }

  let { spec, rows }: Props = $props();

  const items = $derived(
    rows.rows.map((row, i) => ({
      id: `${i}:${String(row[spec.source.dimension] ?? '')}`,
      label: String(row[spec.source.dimension] ?? '—'),
      value: toNumber(row[VALUE]) ?? 0,
    })),
  );
  const max = $derived(Math.max(0, ...items.map((item) => item.value)));
</script>

<div class="list">
  {#if items.length === 0}
    <p class="t-caption list-empty">{m.sandbox_block_empty()}</p>
  {:else}
    <ol class="list-rows">
      {#each items as item (item.id)}
        <li>
          <ProgressBar
            value={item.value}
            max={max || 1}
            size="sm"
            label={item.label}
            detail={formatValue(item.value, spec.format, spec.currency)}
          />
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .list {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
  }
  .list-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list-empty {
    padding: var(--space-4);
    color: var(--color-text-tertiary);
    text-align: center;
  }
</style>
