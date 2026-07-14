<script lang="ts">
  import { BookOpen, Bot, Settings } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import SectionNav from '$lib/components/ui/foundations/SectionNav.svelte';
  import type { SectionNavItem } from '$lib/components/ui/foundations/SectionNav.svelte';
  import { canViewPath, canAct } from '$lib/access/can.svelte';

  // Template subtab only renders for callers who can manage the org's Brain
  // Agent Template (Wave 2) — mirrors the server-side requireOrgCapability
  // gate on /brains/template's load function.
  const items = $derived<SectionNavItem[]>(
    [
      { id: 'brains', label: m.nav_brains(), icon: BookOpen, href: '/brains' },
      { id: 'agents', label: m.brains_nav_agents(), icon: Bot, href: '/brains/agents' },
      { id: 'template', label: m.brains_nav_template(), icon: Settings, href: '/brains/template' },
    ].filter((i) => canViewPath(i.href) && (i.id !== 'template' || canAct('brains', 'manage'))),
  );

  const pathname = $derived(page.url.pathname);

  function isActive(id: string, href: string): boolean {
    if (id === 'brains') return pathname === '/brains';
    return pathname.startsWith(href);
  }

  const activeId = $derived(items.find((i) => isActive(i.id, i.href ?? ''))?.id);
</script>

<SectionNav {items} {activeId} ariaLabel={m.nav_brains()} />
