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
  import { SideNav, type SideNavItem } from '$lib/components/ui';
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

  const items = $derived<SideNavItem[]>([
    { id: 'tools', label: m.nav_tools(), icon: Wrench },
    { id: 'skills', label: m.breadcrumb_skills(), icon: BookOpen },
    { id: 'mcps', label: m.nav_mcps(), icon: Plug },
  ]);
</script>

<svelte:head>
  <title>Capabilities · Minion</title>
</svelte:head>

<div class="h-full flex">
  <SideNav {items} activeId={tab} ariaLabel="Capabilities" header={m.nav_capabilities()} onSelect={setTab} />
  <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
    {#if tab === 'skills'}
      <BuilderHub only="skills" />
    {:else if tab === 'mcps'}
      <McpPanel />
    {:else}
      <BuilderHub only="tools" />
    {/if}
  </div>
</div>
