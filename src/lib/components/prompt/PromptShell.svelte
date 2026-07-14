<script lang="ts">
  import * as splitter from '@zag-js/splitter';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import { promptSections } from '$lib/state/features/prompt-sections.svelte';
  import EmptyState from './EmptyState.svelte';
  import PromptTopbarChip from './PromptTopbarChip.svelte';
  import BreakdownTree from './BreakdownTree.svelte';
  import SelectionDetail from './SelectionDetail.svelte';
  import AssembledPromptPane from './AssembledPromptPane.svelte';
  import { previewSections } from '$lib/services/prompt-sections-rpc';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { buildDraftOverride } from './preview-sync';
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  type CompactPane = 'assembled' | 'sections' | 'detail';
  let compactPane = $state<CompactPane>('assembled');

  // Horizontal split: middle (assembled) | right column (tree + detail).
  const hSplit = useMachine(splitter.machine as never, () => ({
    id: 'prompt-h-splitter',
    panels: [
      { id: 'assembled', minSize: 35 },
      { id: 'right', minSize: 25, maxSize: 60 },
    ],
    defaultSize: [60, 40],
  }));
  const hApi = $derived(splitter.connect(hSplit as never, normalizeProps));

  // Vertical split inside the right column: tree (top) | detail (bottom).
  const vSplit = useMachine(splitter.machine as never, () => ({
    id: 'prompt-v-splitter',
    orientation: 'vertical',
    panels: [
      { id: 'tree', minSize: 25 },
      { id: 'detail', minSize: 25 },
    ],
    defaultSize: [55, 45],
  }));
  const vApi = $derived(splitter.connect(vSplit as never, normalizeProps));

  let previewToken = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function runPreview(includeDraftOverride: boolean) {
    if (!promptSections.agentId) return;
    const token = ++previewToken;
    const draftOverride = includeDraftOverride
      ? buildDraftOverride({
          activeId: promptSections.activeId,
          activeBody: promptSections.activeBody,
          sections: promptSections.sections,
          isDirty: promptSections.isDirty,
        })
      : undefined;
    promptSections.previewLoading = true;
    try {
      const res = await previewSections(promptSections.agentId, promptSections.mode, draftOverride);
      if (token !== previewToken) return;
      promptSections.preview = res;
    } catch (err) {
      if (token !== previewToken) return;
      promptSections.preview = null;
      toastError('Preview failed', (err as Error).message);
    } finally {
      if (token === previewToken) promptSections.previewLoading = false;
    }
  }

  function schedulePreview() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runPreview(true);
    }, 500);
  }

  $effect(() => {
    const agentId = promptSections.agentId;
    const mode = promptSections.mode;
    void agentId;
    void mode;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (agentId) void runPreview(false);
  });

  $effect(() => {
    const agentId = promptSections.agentId;
    const activeBody = promptSections.activeBody;
    const activeId = promptSections.activeId;
    const isDirty = promptSections.isDirty;
    const disabledCount = promptSections.disabledOverrides.length;
    const sectionCount = promptSections.sections.length;
    void activeBody;
    void activeId;
    void isDirty;
    void disabledCount;
    void sectionCount;
    if (!agentId) return;
    schedulePreview();
  });

  $effect(() => {
    return () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      previewToken++;
    };
  });
</script>

<!-- Outer: full-height column. Topbar chip stays pinned at the top of the
     /prompt route content; the global navbar lives in (app)/+layout.svelte
     and remains visible at all times. -->
<div class="flex flex-col h-full min-h-0 overflow-hidden">
  <div
    class="shrink-0 border-b border-border px-4 py-2 md:pr-[var(--notch-clearance)] flex items-center gap-3"
  >
    <PromptTopbarChip />
  </div>

  {#if !promptSections.agentId}
    <EmptyState />
  {:else}
    <nav class="compact-pane-switcher" aria-label={m.nav_prompt()}>
      <Button
        variant={compactPane === 'assembled' ? 'primary' : 'ghost'}
        size="sm"
        aria-pressed={compactPane === 'assembled'}
        onclick={() => (compactPane = 'assembled')}
      >
        {m.misc_assembledPrompt()}
      </Button>
      <Button
        variant={compactPane === 'sections' ? 'primary' : 'ghost'}
        size="sm"
        aria-pressed={compactPane === 'sections'}
        onclick={() => (compactPane = 'sections')}
      >
        {m.prompt_sections()}
      </Button>
      <Button
        variant={compactPane === 'detail' ? 'primary' : 'ghost'}
        size="sm"
        aria-pressed={compactPane === 'detail'}
        onclick={() => (compactPane = 'detail')}
      >
        {m.prompt_sectionSection()}
      </Button>
    </nav>

    <div {...hApi.getRootProps()} class="prompt-panels flex-1 min-h-0 flex overflow-hidden">
      <!-- Middle: assembled prompt -->
      <div
        {...hApi.getPanelProps({ id: 'assembled' })}
        class:compact-hidden={compactPane !== 'assembled'}
        class="prompt-pane overflow-hidden min-w-0"
      >
        <AssembledPromptPane />
      </div>
      <div
        {...hApi.getResizeTriggerProps({ id: 'assembled:right' })}
        class="desktop-divider w-1 bg-border hover:bg-accent cursor-col-resize"
      ></div>
      <!-- Right column: tree on top, detail on bottom -->
      <div
        {...hApi.getPanelProps({ id: 'right' })}
        class:compact-hidden={compactPane === 'assembled'}
        class="prompt-pane prompt-right overflow-hidden border-l border-border min-w-0"
      >
        <div {...vApi.getRootProps()} class="flex flex-col h-full">
          <div
            {...vApi.getPanelProps({ id: 'tree' })}
            class:compact-hidden={compactPane !== 'sections'}
            class="prompt-subpane overflow-hidden min-h-0"
          >
            <BreakdownTree />
          </div>
          <div
            {...vApi.getResizeTriggerProps({ id: 'tree:detail' })}
            class="desktop-divider h-1 bg-border hover:bg-accent cursor-row-resize"
          ></div>
          <div
            {...vApi.getPanelProps({ id: 'detail' })}
            class:compact-hidden={compactPane !== 'detail'}
            class="prompt-subpane overflow-hidden border-t border-border min-h-0"
          >
            <SelectionDetail />
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .compact-pane-switcher {
    display: none;
  }

  @media (max-width: 767.98px) {
    .compact-pane-switcher {
      display: flex;
      padding: var(--space-2) var(--space-page-gutter);
      gap: var(--space-control-gap);
      overflow-x: auto;
      border-bottom: 1px solid var(--color-border-subtle);
      background: var(--color-surface-1);
    }

    .prompt-panels,
    .prompt-right {
      display: flex;
      width: 100%;
    }

    .prompt-pane,
    .prompt-subpane {
      width: 100% !important;
      height: 100% !important;
      flex: 1 1 100% !important;
    }

    .compact-hidden,
    .desktop-divider {
      display: none !important;
    }

    .prompt-right {
      border-left: 0;
    }
  }
</style>
