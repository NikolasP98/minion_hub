<script lang="ts">
  import BuilderHub from '$lib/components/builder/BuilderHub.svelte';
  import { Bot } from 'lucide-svelte';
  import { PageHeader } from '$lib/components/ui';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
  <title>Agent Builder · Minion</title>
</svelte:head>

<PageShell archetype="collection" scroll="none">
  <PageHeader title={m.builder_tabAgents()} subtitle={m.builder_noAgentsDesc()}>
    {#snippet leading()}<Bot size={16} aria-hidden="true" />{/snippet}
  </PageHeader>
  <PageBody padding="none" scroll="none" class="builder-body">
    <BuilderHub only="agents" />
  </PageBody>
</PageShell>

<style>
  :global(.builder-body) {
    display: flex;
    flex-direction: column;
  }
</style>
