<script lang="ts" module>
  export interface QueryResult {
    columns: Array<{ name: string; type: string }>;
    rows: Record<string, unknown>[];
  }
  export type LoadedBlock =
    | { kind: 'kpi'; value: QueryResult; compare?: QueryResult; trend?: QueryResult }
    | { kind: 'chart' | 'table' | 'list'; rows: QueryResult };
</script>

<script lang="ts">
  /**
   * Native renderer for a block element (spec 049). Turns the stored spec into
   * query specs (pure), runs them through the same RBAC-gated endpoint the
   * iframe bridge uses, and hands the rows to the kind's component. The spec
   * is data: nothing here evaluates anything the model wrote.
   */
  import { EmptyState, Skeleton } from '$lib/components/ui';
  import { blockQueries, type BlockQuery } from '$lib/sandbox/blocks/query';
  import type { BlockSpec } from '$lib/sandbox/blocks/schema';
  import * as m from '$lib/paraglide/messages';
  import KpiBlock from './blocks/KpiBlock.svelte';
  import ChartBlock from './blocks/ChartBlock.svelte';
  import TableBlock from './blocks/TableBlock.svelte';
  import ListBlock from './blocks/ListBlock.svelte';

  interface Props {
    spec: BlockSpec;
    title: string;
    /** Bump to re-query (the element row changed). */
    version?: number;
  }

  let { spec, title, version = 0 }: Props = $props();

  async function runQuery(query: BlockQuery): Promise<QueryResult> {
    const res = await fetch('/api/sandbox/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
    });
    const body = (await res.json().catch(() => null)) as
      | (Partial<QueryResult> & { error?: string })
      | null;
    if (!res.ok) throw new Error(body?.error ?? `query failed (${res.status})`);
    return { columns: body?.columns ?? [], rows: body?.rows ?? [] };
  }

  async function load(current: BlockSpec): Promise<LoadedBlock> {
    const q = blockQueries(current, new Date());
    if (q.kind === 'kpi') {
      const [value, compare, trend] = await Promise.all([
        runQuery(q.value),
        q.compare ? runQuery(q.compare) : undefined,
        q.trend ? runQuery(q.trend) : undefined,
      ]);
      return { kind: 'kpi', value, compare, trend };
    }
    return { kind: q.kind, rows: await runQuery(q.rows) };
  }

  // A new spec or version is a new promise; `{#await}` always shows the latest.
  const loaded = $derived.by(() => {
    void version;
    return load(spec);
  });
</script>

<div class="block" data-block-kind={spec.type}>
  {#await loaded}
    <div class="block-loading" aria-busy="true">
      <Skeleton width="40%" height="12px" />
      <Skeleton width="70%" height="28px" />
      <Skeleton width="100%" height="12px" />
    </div>
  {:then data}
    {#if data.kind === 'kpi' && spec.type === 'kpi'}
      <KpiBlock {spec} value={data.value} compare={data.compare} trend={data.trend} />
    {:else if data.kind === 'chart' && spec.type === 'chart'}
      <ChartBlock {spec} {title} rows={data.rows} />
    {:else if data.kind === 'table' && spec.type === 'table'}
      <TableBlock {spec} rows={data.rows} />
    {:else if data.kind === 'list' && spec.type === 'list'}
      <ListBlock {spec} rows={data.rows} />
    {/if}
  {:catch err}
    <EmptyState
      tone="error"
      compact
      title={m.sandbox_block_error_title()}
      description={err instanceof Error ? err.message : String(err)}
    />
  {/await}
</div>

<style>
  .block {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
  }
  .block-loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }
</style>
