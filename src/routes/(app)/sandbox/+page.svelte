<script lang="ts">
  import { onMount } from 'svelte';
  import { LayoutDashboard } from 'lucide-svelte';
  import { iconSizes, PageHeader, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
  import type { GridLayout } from '$lib/components/dashboard/editable-grid';
  import ElementFrame from '$lib/components/sandbox/ElementFrame.svelte';
  import LibraryPanel from '$lib/components/sandbox/LibraryPanel.svelte';
  import { reorder } from '$lib/components/dashboard/editable-grid';
  import { addToPage, DRAG_MIME, type ComponentCopy } from '$lib/sandbox/library';
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
    canvasSummary((data.elements ?? []) as SandboxElementRecord[]),
  );
  // svelte-ignore state_referenced_locally
  const host = createSandboxHost((data.elements ?? []) as SandboxElementRecord[], {
    begin: () => pageLease.invalidate(),
    publish: (elements, capability) => pageLease.update(canvasSummary(elements), capability),
  });

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

  // Edit mode (bound from the grid) shows the component library; a component
  // dropped on a cell is inserted before it, dropped elsewhere it is appended.
  let editing = $state(false);
  async function addComponent(c: ComponentCopy, beforeId: string | null = null) {
    const created = await addToPage(c);
    await host.load();
    if (!beforeId || beforeId === created.id) return;
    const order = reorder(
      byPosition(host.elements).map((e) => e.id),
      created.id,
      beforeId,
    );
    const span = Object.fromEntries(host.elements.map((e) => [e.id, { w: e.w, h: e.h }]));
    await host.arrange(layoutUpdates(host.elements, { order, span }));
  }
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
  function onDrop(e: DragEvent) {
    const raw = e.dataTransfer?.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const cell = (e.target as HTMLElement | null)?.closest('[data-grid-id]');
    void addComponent(JSON.parse(raw) as ComponentCopy, cell?.getAttribute('data-grid-id') ?? null);
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
              }) => void;
            }
          ).registerSandboxTools?.({ signal: ac.signal, acknowledge: host.load }),
        )
        .catch(() => {});
    }
    return () => {
      clearTimeout(layoutTimer);
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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="board" ondragover={onDragOver} ondrop={onDrop}>
        <EditableGrid
          id="sandbox"
          items={gridItems}
          onchange={onLayout}
          rowHeight={220}
          bind:editing
        >
          {#snippet cell(id)}
            {@const element = byId.get(id)}
            {#if element}<ElementFrame {element} {host} />{/if}
          {/snippet}
        </EditableGrid>
      </div>
    {/if}
  </PageBody>
</PageShell>
