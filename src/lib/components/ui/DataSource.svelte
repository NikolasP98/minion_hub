<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { Lock } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { MODULE_LABELS, isDenied, type DatasetDenied } from '$lib/permissions';
  import type { Module } from '$server/services/rbac.service';
  import AsyncBoundary from './foundations/AsyncBoundary.svelte';
  import { iconSizes } from './icon-sizes';

  interface Props {
    /** A load slot: the data, or the marker `datasetCtx` returned for a dataset the role can't view. */
    value: T | DatasetDenied;
    /** Fallback dataset name when the marker is absent; the marker's own module wins. */
    module?: Module;
    /** One caption line instead of the full state (layout slots such as the POS shift banner). */
    compact?: boolean;
    children: Snippet<[T]>;
  }

  let { value, module, compact = false, children }: Props = $props();

  const denied = $derived(isDenied(value) ? value : null);
  const dataset = $derived(
    denied ? (MODULE_LABELS[denied.denied] ?? denied.denied) : (module ? MODULE_LABELS[module] : ''),
  );
</script>

{#if denied}
  {#if compact}
    <p class="t-caption data-denied" data-component="data-source" data-state="denied">
      <Lock size={iconSizes.sm} aria-hidden="true" />
      {m.data_denied_title({ dataset })}
    </p>
  {:else}
    <AsyncBoundary
      state={{
        kind: 'forbidden',
        title: m.data_denied_title({ dataset }),
        description: m.data_denied_hint(),
      }}
    />
  {/if}
{:else}
  {@render children(value as T)}
{/if}

<style>
  .data-denied {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    color: var(--color-text-secondary, var(--color-muted));
  }
</style>
