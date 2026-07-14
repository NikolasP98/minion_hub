<script lang="ts">
  import { page } from '$app/state';
  import MasterFlowCanvas from '$lib/components/flow-editor/MasterFlowCanvas.svelte';
  import { getMasterFlow } from '$lib/flows/master-flows';
  import { ArrowLeft, Workflow } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { Badge, Button, PageHeader } from '$lib/components/ui';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';

  const back = createBackNav('/flow-editor', m.flow_backToFlows);
  const flow = $derived(getMasterFlow(page.params.id ?? ''));
</script>

<PageShell archetype="canvas" scroll="none" variant="canvas">
  <PageHeader
    title={flow?.name ?? m.flow_masterFlowLabel()}
    subtitle={flow?.description ?? m.flow_masterFlowDesc()}
    sticky={false}
  >
    {#snippet leading()}
      <Button variant="ghost" size="sm" shape="icon" onclick={back.go} aria-label={back.label}>
        {#snippet icon()}<ArrowLeft size={16} aria-hidden="true" />{/snippet}
      </Button>
      <Workflow size={16} aria-hidden="true" />
    {/snippet}
    {#snippet secondaryActions()}
      <Badge variant="neutral" size="sm">{m.misc_masterFlowReadOnly()}</Badge>
    {/snippet}
  </PageHeader>

  <PageBody padding="none" scroll="none" class="master-flow-body">
    <AsyncBoundary
      state={flow
        ? { kind: 'ready' }
        : {
            kind: 'empty',
            title: m.misc_masterFlowNotExist(),
            description: m.flow_masterFlowDesc(),
          }}
      class="master-flow-boundary"
    >
      {#snippet emptyAction()}
        <Button href="/flow-editor" variant="secondary" size="sm">{m.misc_backToFlows()}</Button>
      {/snippet}
      {#if flow}<MasterFlowCanvas {flow} />{/if}
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  :global(.master-flow-body),
  :global(.master-flow-boundary) {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }
</style>
