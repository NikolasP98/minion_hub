<script lang="ts">
  import { onMount } from 'svelte';
  import { LayoutDashboard } from 'lucide-svelte';
  import { iconSizes, PageHeader, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import SyncedPage from '$lib/components/sandbox/SyncedPage.svelte';
  import LibraryPanel from '$lib/components/sandbox/LibraryPanel.svelte';
  import { reorder } from '$lib/components/dashboard/editable-grid';
  import { addToPage, type ComponentCopy } from '$lib/sandbox/library';
  import { createSandboxHost, type SandboxElementRecord } from '$lib/sandbox/host.svelte';
  import { byPosition, canvasSummary, layoutUpdates } from '$lib/sandbox/canvas';
  import { createPageContextLease } from '$lib/assistant/page-context';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // The host owns the list from here (it reloads through the API on every
  // write); the server load is only the first paint.
  // svelte-ignore state_referenced_locally
  const pageLease = createPageContextLease(
    canvasSummary((data.elements ?? []) as SandboxElementRecord[], data.wiring ?? null),
  );
  // svelte-ignore state_referenced_locally
  const host = createSandboxHost(
    (data.elements ?? []) as SandboxElementRecord[],
    {
      begin: () => pageLease.invalidate(),
      publish: (elements, wiring, capability) =>
        pageLease.update(canvasSummary(elements, wiring), capability),
    },
    data.wiring ?? null,
  );

  // Edit mode (bound from the grid) shows the component library; a component
  // dropped on a cell is inserted before it, dropped elsewhere it is appended.
  let editing = $state(false);
  async function addComponent(c: ComponentCopy, beforeId: string | null = null) {
    const created = await addToPage(c);
    await host.load();
    if (!beforeId || beforeId === created.id) return;
    // Filters live in the filter bar, not the grid: ordering only sees grid elements.
    const grid = host.elements.filter((e) => e.spec?.type !== 'filter');
    const order = reorder(
      byPosition(grid).map((e) => e.id),
      created.id,
      beforeId,
    );
    const span = Object.fromEntries(grid.map((e) => [e.id, { w: e.w, h: e.h }]));
    await host.arrange(layoutUpdates(host.elements, { order, span }));
  }

  // The agent's canvas map (model-only); cleared when the page unmounts.

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
            mod as {
              registerSandboxTools?: (opts: {
                signal: AbortSignal;
                acknowledge: typeof host.load;
                isFilter: (id: string) => boolean;
              }) => void;
            }
          ).registerSandboxTools?.({
            signal: ac.signal,
            acknowledge: host.load,
            isFilter: (id) => host.elements.some((e) => e.id === id && e.spec?.type === 'filter'),
          }),
        )
        .catch(() => {});
    }
    return () => {
      ac.abort();
      detach();
      pageLease.dispose();
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
    {:else}
      {#if host.elements.length === 0}
        <EmptyState
          icon={LayoutDashboard}
          title={m.sandbox_empty_title()}
          description={m.sandbox_empty_body()}
        />
      {/if}
      {#if editing}
        <LibraryPanel onadd={(c) => void addComponent(c)} />
      {/if}
      <SyncedPage {host} bind:editing onadd={(c, beforeId) => void addComponent(c, beforeId)} />
    {/if}
  </PageBody>
</PageShell>
