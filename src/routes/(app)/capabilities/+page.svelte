<script lang="ts">
  // Capabilities (formerly /tools): a tabbed home for the agent's Tools and
  // Skills. Skills were relocated here from /flow-editor so all reusable agent
  // capabilities live in one place. The active tab is URL-driven (?tab=skills)
  // so deep links and the legacy /tools redirect land correctly.
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Wrench, BookOpen } from 'lucide-svelte';
  import BuilderHub from '$lib/components/builder/BuilderHub.svelte';
  import * as m from '$lib/paraglide/messages';

  type Tab = 'tools' | 'skills';
  const tab = $derived<Tab>(page.url.searchParams.get('tab') === 'skills' ? 'skills' : 'tools');

  function setTab(next: Tab) {
    goto(`/capabilities?tab=${next}`, { keepFocus: true, noScroll: true });
  }

  const TABS: Array<{ id: Tab; label: () => string; icon: typeof Wrench }> = [
    { id: 'tools', label: () => m.nav_tools(), icon: Wrench },
    { id: 'skills', label: () => m.breadcrumb_skills(), icon: BookOpen },
  ];
</script>

<svelte:head>
  <title>Capabilities · Minion</title>
</svelte:head>

<div class="flex flex-col flex-1 min-h-0">
  <!-- Tab bar -->
  <div class="shrink-0 border-b border-border bg-bg/95 backdrop-blur-sm px-4.5 flex items-center gap-1">
    {#each TABS as t (t.id)}
      {@const Icon = t.icon}
      <button
        type="button"
        onclick={() => setTab(t.id)}
        class="flex items-center gap-1.5 text-xs px-3.5 py-2.5 border-b-2 transition-colors duration-100 bg-transparent border-0 cursor-pointer font-[inherit]
          {tab === t.id
            ? 'border-b-accent text-foreground font-semibold'
            : 'border-b-transparent text-muted hover:text-foreground'}"
        aria-current={tab === t.id ? 'page' : undefined}
      >
        <Icon size={13} />
        {t.label()}
      </button>
    {/each}
  </div>

  <!-- Content -->
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    {#if tab === 'skills'}
      <BuilderHub only="skills" />
    {:else}
      <BuilderHub only="tools" />
    {/if}
  </div>
</div>
