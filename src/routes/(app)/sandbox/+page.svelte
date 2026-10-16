<script lang="ts">
  import { onMount } from 'svelte';
  import { LayoutDashboard } from 'lucide-svelte';
  import { iconSizes, PageHeader, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
  import type { GridLayout } from '$lib/components/dashboard/editable-grid';
  import ElementFrame from '$lib/components/sandbox/ElementFrame.svelte';
  import { createSandboxHost, type SandboxElementRecord } from '$lib/sandbox/host.svelte';
  import { canvasSummary, layoutUpdates } from '$lib/sandbox/canvas';
  import { setPageContext } from '$lib/assistant/page-context';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // The host owns the list from here (it reloads through the API on every
  // write); the server load is only the first paint.
  // svelte-ignore state_referenced_locally
  const host = createSandboxHost((data.elements ?? []) as SandboxElementRecord[]);

  // The element rows ARE the layout (spec 013 D2): the grid runs controlled and
  // every reorder/resize becomes the minimal PATCH set, debounced so a drag
  // across several cells is one write batch.
  const gridItems = $derived(host.elements.map((e) => ({ id: e.id, w: e.w, h: e.h })));
  const byId = $derived(new Map(host.elements.map((e) => [e.id, e])));
  let layoutTimer: ReturnType<typeof setTimeout> | undefined;
  function onLayout(layout: GridLayout) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => void host.arrange(layoutUpdates(host.elements, layout)), 300);
  }

  // The agent's canvas map (model-only); cleared when the page unmounts.
  $effect(() => setPageContext(canvasSummary(host.elements)));

  // The assistant's page-scoped tools land with S3; `import.meta.glob` keeps the
  // page building while that module is absent (empty map, no resolve error).
  const toolModules = import.meta.glob('/src/lib/sandbox/tools.ts');

  onMount(() => {
    const ac = new AbortController();
    const detach = host.attach();
    for (const loadTools of Object.values(toolModules)) {
      void loadTools()
        .then((mod) =>
          (
            mod as { registerSandboxTools?: (opts: { signal: AbortSignal }) => void }
          ).registerSandboxTools?.({ signal: ac.signal }),
        )
        .catch(() => {});
    }
    return () => {
      clearTimeout(layoutTimer);
      ac.abort();
      detach();
    };
  });
</script>

<PageShell archetype="dashboard" scroll="page" labelledBy="sandbox-title">
  <PageHeader titleId="sandbox-title" title={m.nav_sandbox()} subtitle={m.sandbox_subtitle()}>
    {#snippet leading()}<LayoutDashboard
        size={iconSizes.md}
        class="shrink-0 text-accent"
      />{/snippet}
  </PageHeader>

  <PageBody>
    {#if host.error}
      <EmptyState tone="error" title={m.sandbox_empty_title()} description={host.error} />
    {:else if host.elements.length === 0}
      <EmptyState
        icon={LayoutDashboard}
        title={m.sandbox_empty_title()}
        description={m.sandbox_empty_body()}
      />
    {:else}
      <EditableGrid id="sandbox" items={gridItems} onchange={onLayout} rowHeight={220}>
        {#snippet cell(id)}
          {@const element = byId.get(id)}
          {#if element}<ElementFrame {element} {host} />{/if}
        {/snippet}
      </EditableGrid>
    {/if}
  </PageBody>
</PageShell>
