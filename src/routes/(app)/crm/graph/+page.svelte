<script lang="ts">
  import type { PageData } from './$types';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import CrmGraph from '$lib/components/crm/graph/CrmGraph.svelte';

  let { data }: { data: PageData } = $props();

  const org = $derived.by(() => {
    const orgs = (page.data.organizations ?? []) as Array<{ id: string; name: string }>;
    const active = page.data.activeOrgId as string | null;
    return (
      orgs.find((candidate) => candidate.id === active) ?? orgs[0] ?? { id: 'org', name: 'Organization' }
    );
  });
</script>

<PageShell archetype="canvas" scroll="none" labelledBy="crm-graph-title">
  <PageHeader
    titleId="crm-graph-title"
    title={m.crm_graph_title()}
    subtitle={m.crm_graph_subtitle()}
    sticky={false}
  />

  <PageBody padding="none" scroll="none" class="crm-graph-body">
    <section class="crm-graph-stage" aria-label={m.crm_graph_title()}>
      <CrmGraph {org} rows={data.rows} />
    </section>
  </PageBody>
</PageShell>

<style>
  :global(.crm-graph-body),
  .crm-graph-stage {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }
  .crm-graph-stage {
    position: relative;
    overflow: hidden;
  }
</style>
