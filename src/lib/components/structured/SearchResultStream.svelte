<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import type { SearchResult } from '$lib/schemas/structured-response';
  import PartialField from './PartialField.svelte';

  let {
    partial,
    done = false,
    error = null,
  }: {
    partial: Partial<SearchResult> | null;
    done?: boolean;
    error?: string | null;
  } = $props();
</script>

<div class="structured-card">
  {#if error}
    <div class="error-banner">
      <span class="error-icon">⚠</span>
      <span>{error}</span>
      {#if partial}
        <span class="error-hint">{m.search_partialResultShownBelow()}</span>
      {/if}
    </div>
  {/if}

  <div class="card-header">
    <span class="card-label">{m.search_results()}</span>
    {#if partial?.query}
      <span class="query-chip">"{partial.query}"</span>
    {/if}
    {#if !done}
      <span class="generating-badge">{m.search_generating()}</span>
    {/if}
  </div>

  {#if partial?.results?.length}
    <ul class="results-list">
      {#each partial.results as result, i (i)}
        <li class="result-item">
          <div class="result-title-row">
            <PartialField
              value={result.title}
              class="result-title"
              skeletonClass="w-36 h-3"
            />
          </div>
          <div class="result-url-row">
            <PartialField
              value={result.url}
              class="result-url"
              skeletonClass="w-28 h-2.5"
            />
          </div>
          {#if result.snippet || !done}
            <div class="result-snippet-row">
              <PartialField
                value={result.snippet}
                class="result-snippet"
                skeletonClass="w-full h-2.5"
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else if !done}
    <div class="results-placeholder" aria-label={m.search_loadingResults()}>
      {#each { length: 3 } as _, i (i)}
        <div class="result-skeleton">
          <span class="title-skeleton" style="width: {100 + i * 20}px"></span>
          <span class="url-skeleton" style="width: {70 + i * 10}px"></span>
          <span class="snippet-skeleton"></span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .structured-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-card);
    padding: 12px 14px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: var(--color-foreground);
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-destructive) 12%, transparent);
    color: var(--color-destructive);
    font-size: 11px;
  }

  .error-icon { flex-shrink: 0; }
  .error-hint { margin-left: auto; color: var(--color-muted); }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .card-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-muted);
  }

  .query-chip {
    font-size: 11px;
    color: var(--color-foreground);
    background: var(--color-bg3);
    padding: 1px 7px;
    border-radius: 100px;
    font-style: italic;
  }

  .generating-badge {
    font-size: 10px;
    color: var(--color-status-thinking);
    animation: pulse 1.2s ease-in-out infinite;
    margin-left: auto;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .results-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-item {
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .result-title-row,
  .result-url-row,
  .result-snippet-row {
    display: flex;
    align-items: baseline;
    min-height: 14px;
  }

  :global(.result-title) {
    font-weight: 600;
    font-size: 12px;
    color: var(--color-accent);
  }

  :global(.result-url) {
    font-size: 10px;
    color: var(--color-success);
    font-family: monospace;
    word-break: break-all;
  }

  :global(.result-snippet) {
    font-size: 11px;
    color: var(--color-muted);
    line-height: 1.5;
  }

  .results-placeholder {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-skeleton {
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .title-skeleton,
  .url-skeleton,
  .snippet-skeleton {
    display: block;
    border-radius: 3px;
    background: var(--color-border);
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .title-skeleton { height: 12px; }
  .url-skeleton { height: 10px; }
  .snippet-skeleton { height: 10px; width: 90%; }

  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
</style>
