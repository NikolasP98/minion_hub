<script lang="ts">
  import { onDestroy } from 'svelte';
  import { CalendarDays, Search } from 'lucide-svelte';
  import { Badge, Button, Card, EmptyState, Input, iconSizes } from '$lib/components/ui';
  import {
    brainSearchEmptyState,
    isCurrentBrainSearchRequest,
    type BrainSearchEmptyReason,
  } from '$lib/brains/brain-search-state';
  import * as m from '$lib/paraglide/messages';
  import type { BrainSearchHitDTO } from '$lib/types/brains';

  type RetrievalMode = 'hybrid' | 'legacy';
  type SearchHit = BrainSearchHitDTO & {
    sourceName?: string | null;
    connector?: string | null;
    kind?: string | null;
    occurredAt?: string | null;
    scores?: { normalized?: number | null } | null;
    matchBasis?: 'exact' | 'fuzzy' | 'hybrid' | 'semantic' | 'legacy';
    relevanceTier?: 'anchored' | 'hybrid' | 'semantic' | 'legacy';
  };

  interface SearchResponse {
    mode?: RetrievalMode;
    hits: SearchHit[];
    diagnostics?: { emptyReason?: BrainSearchEmptyReason | null };
  }

  let { brainId }: { brainId: string } = $props();

  let query = $state('');
  let submittedQuery = $state('');
  let hits = $state<SearchHit[] | null>(null);
  let retrievalMode = $state<RetrievalMode | null>(null);
  let emptyReason = $state<BrainSearchEmptyReason | null>(null);
  const emptyState = $derived(brainSearchEmptyState(emptyReason));
  let searching = $state(false);
  let error = $state('');
  let renderedBrainId = $state<string | null>(null);
  let requestGeneration = 0;
  let inflight: AbortController | null = null;

  $effect(() => {
    if (renderedBrainId === null) {
      renderedBrainId = brainId;
      return;
    }
    if (brainId === renderedBrainId) return;
    renderedBrainId = brainId;
    requestGeneration += 1;
    inflight?.abort();
    inflight = null;
    query = '';
    submittedQuery = '';
    hits = null;
    retrievalMode = null;
    emptyReason = null;
    searching = false;
    error = '';
  });

  onDestroy(() => {
    requestGeneration += 1;
    inflight?.abort();
  });

  function excerptFor(text: string, searchQuery: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const maxLength = 320;
    if (normalized.length <= maxLength) return normalized;

    const lowerText = normalized.toLocaleLowerCase();
    const terms = searchQuery
      .toLocaleLowerCase()
      .split(/\s+/)
      .map((term) => term.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((term) => term.length > 1);
    const positions = terms
      .map((term) => lowerText.indexOf(term))
      .filter((position) => position >= 0);
    const matchAt = positions.length > 0 ? Math.min(...positions) : 0;
    let start = Math.max(0, matchAt - 96);
    let end = Math.min(normalized.length, start + maxLength);

    if (start > 0) {
      const nextSpace = normalized.indexOf(' ', start);
      if (nextSpace >= 0 && nextSpace < end) start = nextSpace + 1;
    }
    if (end < normalized.length) {
      const previousSpace = normalized.lastIndexOf(' ', end);
      if (previousSpace > start) end = previousSpace;
    }

    return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
  }

  function modeLabel(mode: RetrievalMode): string {
    return mode === 'hybrid' ? m.brains_search_mode_hybrid() : m.brains_search_mode_legacy();
  }

  function matchLabel(hit: SearchHit): string {
    switch (hit.matchBasis) {
      case 'exact':
        return m.brains_search_match_exact();
      case 'fuzzy':
        return m.brains_search_match_fuzzy();
      case 'hybrid':
        return m.brains_search_match_hybrid();
      case 'semantic':
        return m.brains_search_match_semantic();
      case 'legacy':
        return m.brains_search_match_legacy();
      default:
        return m.brains_search_match_ranked();
    }
  }

  async function submit() {
    const q = query.trim();
    if (!q || searching) return;
    const requestIdentity = { brainId, generation: ++requestGeneration };
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    searching = true;
    error = '';
    try {
      const res = await fetch(`/api/brains/${encodeURIComponent(requestIdentity.brainId)}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, limit: 10 }),
        signal: controller.signal,
      });
      if (!isCurrentBrainSearchRequest(requestIdentity, brainId, requestGeneration)) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (!isCurrentBrainSearchRequest(requestIdentity, brainId, requestGeneration)) return;
        error = (body as { message?: string }).message ?? m.brains_search_error();
        hits = null;
        retrievalMode = null;
        emptyReason = null;
        return;
      }
      const body = (await res.json()) as SearchResponse;
      if (!isCurrentBrainSearchRequest(requestIdentity, brainId, requestGeneration)) return;
      submittedQuery = q;
      hits = body.hits;
      retrievalMode = body.mode ?? null;
      emptyReason = body.diagnostics?.emptyReason ?? null;
    } catch (caught) {
      if (!isCurrentBrainSearchRequest(requestIdentity, brainId, requestGeneration)) return;
      if (
        caught &&
        typeof caught === 'object' &&
        'name' in caught &&
        caught.name === 'AbortError'
      ) {
        return;
      }
      error = caught instanceof Error ? caught.message : m.brains_search_error();
    } finally {
      if (isCurrentBrainSearchRequest(requestIdentity, brainId, requestGeneration)) {
        inflight = null;
        searching = false;
      }
    }
  }
</script>

<div class="search-panel">
  <form
    class="search-form"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <Input
      type="search"
      size="md"
      bind:value={query}
      placeholder={m.brains_search_placeholder()}
      aria-label={m.brains_search_placeholder()}
      class="w-full"
    >
      {#snippet leading()}<Search size={iconSizes.sm} />{/snippet}
    </Input>
    <Button
      type="submit"
      variant="primary"
      size="md"
      disabled={!query.trim() || searching}
      loading={searching}
    >
      {m.brains_search_submit()}
    </Button>
  </form>

  {#if error}
    <p class="search-error" role="alert">{error}</p>
  {/if}

  {#if hits === null}
    <EmptyState title={m.brains_search_empty()} compact />
  {:else if hits.length === 0 && emptyState === 'policy-filtered'}
    <EmptyState
      title={m.brains_search_filtered_title()}
      description={m.brains_search_filtered_description()}
      compact
    />
  {:else if hits.length === 0 && emptyState === 'no-canonical'}
    <EmptyState
      title={m.brains_search_no_canonical_title()}
      description={m.brains_search_no_canonical_description()}
      compact
    />
  {:else if hits.length === 0}
    <EmptyState title={m.brains_search_no_hits()} compact />
  {:else}
    <div class="result-heading">
      <p>
        {m.brains_search_result_count({ count: hits.length })}
        {#if retrievalMode}
          <span aria-hidden="true">·</span> {modeLabel(retrievalMode)}
        {/if}
      </p>
    </div>

    <ol class="result-list">
      {#each hits as hit, index (hit.chunkId)}
        <li>
          <Card elevation={1} padding="sm">
            <article class="result-card">
              <header>
                <div class="result-identity">
                  <h3 title={hit.documentTitle}>{hit.documentTitle}</h3>
                  <div class="source-meta">
                    {#if hit.connector}
                      <Badge variant="neutral" size="sm">{hit.connector}</Badge>
                    {/if}
                    {#if hit.sourceName}
                      <span>{hit.sourceName}</span>
                    {/if}
                    {#if hit.kind}
                      <span>{hit.kind}</span>
                    {/if}
                    {#if hit.occurredAt}
                      <span>
                        <CalendarDays size={iconSizes.xs} aria-hidden="true" />
                        <time datetime={hit.occurredAt}>{formatDate(hit.occurredAt)}</time>
                      </span>
                    {/if}
                  </div>
                </div>
                <div class="rank-meta">
                  <Badge variant="neutral" size="sm">
                    {m.brains_search_rank({ rank: index + 1 })}
                  </Badge>
                  <span>{matchLabel(hit)}</span>
                </div>
              </header>
              <p class="excerpt clamp-3">{excerptFor(hit.chunkText, submittedQuery)}</p>
            </article>
          </Card>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .search-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .search-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
  }

  .search-error {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
  }

  .result-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .result-heading p {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .result-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .result-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .result-card header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .result-identity {
    min-width: 0;
  }

  .result-identity h3 {
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-meta {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .source-meta > span {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-1);
  }

  .rank-meta {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
    font-variant-numeric: tabular-nums;
  }

  .excerpt {
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
    white-space: pre-line;
  }

  @media (max-width: 767.98px) {
    .result-card header {
      flex-direction: column;
      gap: var(--space-2);
    }

    .rank-meta {
      width: 100%;
      justify-content: space-between;
    }
  }
</style>
