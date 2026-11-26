<script lang="ts">
  /**
   * A synced page (spec 150): the filter bar above the grid, the grid of data and
   * custom elements, and the page values that connect them. Filters never take a
   * grid cell. The values source is pluggable (`localValues` today, the URL in S2)
   * and the renderer is a prop-driven component so the S3 draft preview can reuse it.
   */
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
  import type { GridLayout } from '$lib/components/dashboard/editable-grid';
  import { byPosition, layoutUpdates } from '$lib/sandbox/canvas';
  import type { SandboxHost } from '$lib/sandbox/host.svelte';
  import { DRAG_MIME, type ComponentCopy } from '$lib/sandbox/library';
  import {
    bindingKey,
    createPageValues,
    localValues,
    resolveBindings,
  } from '$lib/sandbox/values.svelte';
  import ElementFrame from './ElementFrame.svelte';
  import FilterBar from './FilterBar.svelte';

  interface Props {
    host: SandboxHost;
    /** Edit mode (bound from the grid): the page shows the component library while true. */
    editing?: boolean;
    /** A component dropped on a cell (`beforeId`) or on the board (null). */
    onadd: (component: ComponentCopy, beforeId: string | null) => void;
  }

  let { host, editing = $bindable(false), onadd }: Props = $props();

  const values = createPageValues(localValues(() => host.wiring?.publishers ?? []));

  const filters = $derived(byPosition(host.elements.filter((e) => e.spec?.type === 'filter')));
  const gridElements = $derived(host.elements.filter((e) => e.spec?.type !== 'filter'));
  const gridItems = $derived(gridElements.map((e) => ({ id: e.id, w: e.w, h: e.h })));
  const byId = $derived(new Map(gridElements.map((e) => [e.id, e])));

  // The element rows ARE the layout (spec 013 D2): every reorder/resize becomes
  // the minimal PATCH set, debounced so a drag across several cells is one batch.
  let layoutTimer: ReturnType<typeof setTimeout> | undefined;
  function onLayout(layout: GridLayout) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => void host.arrange(layoutUpdates(host.elements, layout)), 300);
  }
  $effect(() => () => {
    clearTimeout(layoutTimer);
    values.cancel();
  });

  /** Working connections of one block with the value each currently reads. */
  const bindingsFor = (id: string) =>
    resolveBindings(host.wiring?.blocks[id]?.bindings ?? [], values.applied);

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
    onadd(JSON.parse(raw) as ComponentCopy, cell?.getAttribute('data-grid-id') ?? null);
  }
</script>

<FilterBar {filters} {host} read={values.draft} onchange={values.set} />

<!-- A pointer-only drop target for library components: not an interactive control. -->
<div class="board" role="presentation" ondragover={onDragOver} ondrop={onDrop}>
  <EditableGrid id="sandbox" items={gridItems} onchange={onLayout} rowHeight={220} bind:editing>
    {#snippet cell(id)}
      {@const element = byId.get(id)}
      {#if element}
        {@const bindings = bindingsFor(id)}
        <ElementFrame
          {element}
          {host}
          {bindings}
          bindingKey={bindingKey(bindings)}
          wiringAvailable={host.wiring !== null}
        />
      {/if}
    {/snippet}
  </EditableGrid>
</div>
