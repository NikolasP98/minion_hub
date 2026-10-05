<script lang="ts">
  import { onMount, onDestroy, type ComponentProps } from 'svelte';
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import { Button } from '@minion-stack/ui';
  import Agents from '../../../src/lib/components/builder/_builder-hub/AgentsGrid.svelte';
  import Skills from '../../../src/lib/components/builder/_builder-hub/SkillsGrid.svelte';
  import Tools from '../../../src/lib/components/builder/_builder-hub/ToolsGrid.svelte';
  import Flows from '../../../src/lib/components/flow-editor/FlowGroupSection.svelte';
  import Masters from '../../../src/lib/components/flow-editor/MasterFlowsSection.svelte';
  import Workshop from '../../../src/routes/(app)/agents/workshop/+page.svelte';
  import { trace, record, resetTrace } from './state.svelte';
  let surface = $state(new URLSearchParams(location.search).get('surface') ?? 'agents');
  let locale = $state<'en' | 'es'>(
    new URLSearchParams(location.search).get('locale') === 'es' ? 'es' : 'en',
  );
  const updatedAt = Date.parse('2026-10-03T12:00:00Z');
  const tools: ComponentProps<typeof Tools>['tools'] = [
    {
      id: 'tool-a',
      name: 'Stock lookup',
      source: 'custom',
      status: 'draft',
      scriptLang: 'javascript',
      description: 'Synthetic custom tool',
      updatedAt,
    },
    {
      id: 'tool-b',
      name: 'Calendar lookup',
      source: 'gateway',
      enabled: true,
      description: 'Synthetic gateway tool',
      groups: [],
    },
  ];
  const flows = [
    { id: 'flow-a', name: 'Reception workflow', nodeCount: 3, updatedAt },
    { id: 'flow-b', name: 'Stock workflow', nodeCount: 4, updatedAt },
  ];
  onMount(() => {
    const originalFetch = globalThis.fetch;
    const fixtureFetch: typeof fetch = async () => {
      trace.unexpectedRequests++;
      throw new Error('Network requests are outside this card-only evidence fixture');
    };
    globalThis.fetch = fixtureFetch;
    function captureLink(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      // Contain ordinary navigation; modifier clicks retain their native new-tab
      // behavior against this loopback-only fixture. Destination routes are tested separately.
      record(`link:${link.getAttribute('href')}`);
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) event.preventDefault();
    }
    document.addEventListener('click', captureLink);
    return () => {
      if (globalThis.fetch === fixtureFetch) globalThis.fetch = originalFetch;
      document.removeEventListener('click', captureLink);
    };
  });
  onDestroy(resetTrace);
</script>

<div class="fixture">
  <aside class="controls">
    <p class="t-label">HC-026 · actual cards · synthetic data and action callbacks</p>
    <div class="toolbar">
      <label
        >Surface <select bind:value={surface} onchange={resetTrace}>
          <option value="agents">Agents</option><option value="skills">Skills</option>
          <option value="tools">Tools</option><option value="flows">Flows</option>
          <option value="masters">Master flows</option><option value="workshop">Workshop</option>
        </select></label
      >
      <Button type="button" size="touch" onclick={resetTrace}>Clear trace</Button>
      <label
        >Locale <select bind:value={locale}
          ><option value="en">English</option><option value="es">Español</option></select
        ></label
      >
    </div>
    <output aria-label="Action trace">{trace.events.join(' → ') || 'No actions'}</output>
    <p class="t-caption">
      Unexpected requests: {trace.unexpectedRequests} · Form submissions: {trace.submissions}
    </p>
  </aside>
  <ParaglideJS {i18n} languageTag={locale}>
    <form
      class="product"
      onsubmit={(event) => {
        event.preventDefault();
        trace.submissions++;
      }}
    >
      {#if surface === 'agents'}<Agents onDelete={(id) => record(`delete:${id}`)} />
      {:else if surface === 'skills'}<Skills onDelete={(id) => record(`delete:${id}`)} />
      {:else if surface === 'tools'}<Tools
          {tools}
          isAdmin={true}
          onDeleteCustom={(id) => record(`delete:${id}`)}
        />
      {:else if surface === 'flows'}<Flows
          title="My flows"
          kind="my"
          {flows}
          onDeleteFlow={(flow) => record(`delete:${flow.id}`)}
        />
      {:else if surface === 'masters'}<Masters />
      {:else if surface === 'workshop'}<Workshop />{/if}
    </form>
  </ParaglideJS>
</div>

<style>
  .fixture {
    min-height: 100dvh;
    background: var(--color-canvas);
    color: var(--color-text-primary);
  }
  .controls {
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border-default);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  select {
    min-height: var(--control-height-touch);
    background: var(--color-surface-2);
    color: inherit;
    border: 1px solid var(--color-border-default);
  }
  output {
    overflow-wrap: anywhere;
  }
  .product {
    padding: var(--space-4);
    min-width: 0;
  }
</style>
