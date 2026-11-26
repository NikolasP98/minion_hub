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
   *
   * Page connections (spec 150): `bindings` are the already-resolved working
   * connections. The load is keyed on the spec + version + `bindingKey`, so a
   * change to another block's filter never reloads this one, and a newer key
   * aborts the request it overtook.
   */
  import { untrack } from 'svelte';
  import { EmptyState, Skeleton } from '$lib/components/ui';
  import { blockQueries, type Binding, type BlockQuery } from '$lib/sandbox/blocks/query';
  import type { DataBlockSpec } from '$lib/sandbox/blocks/schema';
  import * as m from '$lib/paraglide/messages';
  import KpiBlock from './blocks/KpiBlock.svelte';
  import ChartBlock from './blocks/ChartBlock.svelte';
  import TableBlock from './blocks/TableBlock.svelte';
  import ListBlock from './blocks/ListBlock.svelte';

  interface Props {
    spec: DataBlockSpec;
    title: string;
    /** Bump to re-query (the element row changed). */
    version?: number;
    /** Working connections with the page value each one currently reads. */
    bindings?: Binding[];
    /** Stable string identity of `bindings`: the load re-runs only when this changes. */
    bindingKey?: string;
    /** False when the server's wiring report could not be read: connected blocks then fail closed. */
    wiringAvailable?: boolean;
  }

  let {
    spec,
    title,
    version = 0,
    bindings = [],
    bindingKey = '',
    wiringAvailable = true,
  }: Props = $props();

  async function runQuery(query: BlockQuery, signal: AbortSignal): Promise<QueryResult> {
    const res = await fetch('/api/sandbox/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
      signal,
    });
    const body = (await res.json().catch(() => null)) as
      (Partial<QueryResult> & { error?: string }) | null;
    if (!res.ok) throw new Error(body?.error ?? `query failed (${res.status})`);
    return { columns: body?.columns ?? [], rows: body?.rows ?? [] };
  }

  async function load(
    current: DataBlockSpec,
    applied: Binding[],
    signal: AbortSignal,
  ): Promise<LoadedBlock> {
    const q = blockQueries(current, new Date(), applied);
    if (q.kind === 'kpi') {
      const [value, compare, trend] = await Promise.all([
        runQuery(q.value, signal),
        q.compare ? runQuery(q.compare, signal) : undefined,
        q.trend ? runQuery(q.trend, signal) : undefined,
      ]);
      return { kind: 'kpi', value, compare, trend };
    }
    return { kind: q.kind, rows: await runQuery(q.rows, signal) };
  }

  const blocked = $derived(!wiringAvailable && (spec.listens?.length ?? 0) > 0);

  let data = $state<LoadedBlock | null>(null);
  let failure = $state<string | null>(null);
  let busy = $state(true);

  // A new spec, version or binding key is a new load; the previous one is
  // aborted. Bindings are read untracked: the key is their identity.
  // A string `$derived` only notifies when its VALUE changes, so a host reload that
  // swaps in structurally equal spec objects does not re-query.
  const loadKey = $derived(JSON.stringify(spec) + '|' + version + '|' + bindingKey);

  $effect(() => {
    void loadKey;
    if (blocked) {
      busy = false;
      return;
    }
    const controller = new AbortController();
    const current = untrack(() => $state.snapshot(spec) as DataBlockSpec);
    const applied = untrack(() => $state.snapshot(bindings) as Binding[]);
    busy = true;
    load(current, applied, controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        data = next;
        failure = null;
        busy = false;
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        failure = err instanceof Error ? err.message : String(err);
        data = null;
        busy = false;
      },
    );
    return () => controller.abort();
  });
</script>

<div class="block" data-block-kind={spec.type} aria-busy={busy}>
  {#if blocked}
    <EmptyState
      tone="error"
      compact
      title={m.sandbox_block_error_title()}
      description={m.sandbox_wiring_unavailable()}
    />
  {:else if failure}
    <EmptyState tone="error" compact title={m.sandbox_block_error_title()} description={failure} />
  {:else if !data}
    <div class="block-loading" aria-busy="true">
      <Skeleton width="40%" height="12px" />
      <Skeleton width="70%" height="28px" />
      <Skeleton width="100%" height="12px" />
    </div>
  {:else if data.kind === 'kpi' && spec.type === 'kpi'}
    <KpiBlock {spec} value={data.value} compare={data.compare} trend={data.trend} />
  {:else if data.kind === 'chart' && spec.type === 'chart'}
    <ChartBlock {spec} {title} rows={data.rows} />
  {:else if data.kind === 'table' && spec.type === 'table'}
    <TableBlock {spec} rows={data.rows} />
  {:else if data.kind === 'list' && spec.type === 'list'}
    <ListBlock {spec} rows={data.rows} />
  {/if}
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
