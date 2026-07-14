<script lang="ts">
  // Capabilities (formerly /tools): a tabbed home for the agent's Tools, Skills
  // and MCP servers. Skills were relocated here from /flow-editor so all reusable
  // agent capabilities live in one place. The active tab is URL-driven
  // (?tab=skills) so deep links and the legacy /tools redirect land correctly.
  // The tabs render as a vertical second nav (mirrors /scheduling).
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Wrench, BookOpen, Plug } from 'lucide-svelte';
  import BuilderHub from '$lib/components/builder/BuilderHub.svelte';
  import McpPanel from '$lib/components/builder/McpPanel.svelte';
  import { PageHeader } from '$lib/components/ui';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import SectionNav from '$lib/components/ui/foundations/SectionNav.svelte';
  import SectionShell from '$lib/components/ui/foundations/SectionShell.svelte';
  import type { SectionNavItem } from '$lib/components/ui/foundations/SectionNav.svelte';
  import * as m from '$lib/paraglide/messages';

  type Tab = 'tools' | 'skills' | 'mcps';
  const VALID: Tab[] = ['tools', 'skills', 'mcps'];
  const tab = $derived<Tab>(
    VALID.includes(page.url.searchParams.get('tab') as Tab)
      ? (page.url.searchParams.get('tab') as Tab)
      : 'tools',
  );

  function setTab(next: string) {
    goto(`/capabilities?tab=${next}`, { keepFocus: true, noScroll: true });
  }

  const items = $derived<SectionNavItem[]>([
    { id: 'tools', label: m.nav_tools(), icon: Wrench },
    { id: 'skills', label: m.breadcrumb_skills(), icon: BookOpen },
    { id: 'mcps', label: m.nav_mcps(), icon: Plug },
  ]);
  const activeItem = $derived(items.find((item) => item.id === tab));
</script>

<svelte:head>
  <title>Capabilities · Minion</title>
</svelte:head>

<SectionShell>
  {#snippet navigation()}
    <SectionNav {items} activeId={tab} ariaLabel={m.nav_capabilities()} onSelect={setTab} />
  {/snippet}

  <PageShell archetype="collection" scroll="none">
    <PageHeader
      title={activeItem?.label ?? m.nav_capabilities()}
      subtitle={m.tools_description()}
    />
    <PageBody padding="none" scroll="none" class="capability-body">
      {#if tab === 'skills'}
        <BuilderHub only="skills" />
      {:else if tab === 'mcps'}
        <McpPanel />
      {:else}
        <BuilderHub only="tools" />
      {/if}
    </PageBody>
  </PageShell>
</SectionShell>

<style>
  :global(.capability-body) {
    display: flex;
    flex-direction: column;
  }
</style>
