<script lang="ts">
  // Cross-module Connections panel — Minion's port of ERPNext's declarative
  // form dashboard (customer_dashboard.py): related-record counts per module,
  // rendered from a config the server builds (connections.service.ts). Purely
  // presentational; no fetching here.
  import type { ConnGroup } from '$server/services/connections.service';
  import { Plus } from 'lucide-svelte';

  let { groups }: { groups: ConnGroup[] } = $props();
</script>

<section class="card">
  <header class="card-h"><span>Connections</span></header>
  <div class="groups">
    {#each groups as g (g.label)}
      <div class="group">
        <span class="g-label">{g.label}</span>
        <div class="items">
          {#each g.items as it (it.key)}
            <span class="chip-wrap">
              {#if it.comingSoon}
                <span class="chip soon" title="Coming soon">
                  <span class="n">—</span>{it.label}
                </span>
              {:else if it.href}
                <a class="chip" href={it.href} class:zero={it.count === 0}>
                  <span class="n">{it.count}</span>{it.label}
                </a>
              {:else}
                <span class="chip" class:zero={it.count === 0}>
                  <span class="n">{it.count}</span>{it.label}
                </span>
              {/if}
              {#if it.newHref}
                <a
                  class="new-btn"
                  href={it.newHref}
                  title="New {it.label}"
                  aria-label="New {it.label}"
                >
                  <Plus size={12} />
                </a>
              {/if}
            </span>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3) var(--space-4);
  }
  .card-h {
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-2);
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .group {
    display: grid;
    grid-template-columns: 5rem 1fr;
    align-items: start;
    gap: var(--space-2);
  }
  .g-label {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    padding-top: var(--space-0-5);
  }
  .items {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .chip-wrap {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
  }
  .new-btn {
    display: inline-grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: var(--radius-full);
    color: var(--color-muted-foreground);
    border: 1px dashed var(--hairline);
  }
  .new-btn:hover {
    color: var(--color-accent);
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2) var(--space-0-5) var(--space-1);
    border-radius: var(--radius-full);
    font-size: var(--font-size-caption);
    color: var(--color-foreground);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
  }
  a.chip:hover {
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .chip .n {
    display: inline-grid;
    place-items: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.3rem;
    border-radius: var(--radius-full);
    font-size: var(--font-size-caption);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  }
  .chip.zero {
    opacity: 0.55;
  }
  .chip.zero .n {
    color: var(--color-muted-foreground);
    background: color-mix(in srgb, var(--color-muted-foreground) 14%, transparent);
  }
  .chip.soon {
    opacity: 0.5;
    border-style: dashed;
  }
  .chip.soon .n {
    color: var(--color-muted-foreground);
    background: transparent;
  }
</style>
