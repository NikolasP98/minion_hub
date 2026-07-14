<script lang="ts">
  import { page } from '$app/state';
  import { type Snippet } from 'svelte';
  import KanbanNavRail from '$lib/components/workforce/KanbanNavRail.svelte';
  import { PageShell, SectionShell } from '$lib/components/ui/foundations';
  import { workforceRouteShell } from '$lib/routes/business-route-shells';
  let { children }: { children: Snippet } = $props();

  const routeShell = $derived(workforceRouteShell(page.url.pathname));
</script>

<!--
	KANBAN plugin shell. The icon rail (KanbanNavRail) gives the detail views —
	dashboard / issues / approvals / goals / projects / org — a compact /my-agent
	style sub-nav, so the section reads as a standalone plugin rather than six
	expanded entries in the primary sidebar.

	The right pane keeps the single shared scroll container the workforce subtree
	relies on. AppViewport owns dynamic viewport height and SectionShell owns the
	responsive rail-to-strip transformation; this main region is the one vertical
	scroll owner for ordinary workforce pages. Boards keep only their named inline
	scroll region.
-->
<PageShell
  archetype={routeShell.archetype}
  scroll={routeShell.scroll}
  landmark={routeShell.landmark}
>
  <SectionShell mode="responsive">
    {#snippet navigation()}<KanbanNavRail />{/snippet}
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {@render children()}
    </div>
  </SectionShell>
</PageShell>
