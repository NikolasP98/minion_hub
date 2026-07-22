<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { BookOpen, Bot, FileText, Settings } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import SectionNav from '$lib/components/ui/foundations/SectionNav.svelte';
  import type { SectionNavItem } from '$lib/components/ui/foundations/SectionNav.svelte';
  import { canViewPath, canAct } from '$lib/access/can.svelte';

  // Configuration subtabs only render for callers who can manage the org's
  // Brains — mirrors the route-owned server capability gates.
  const items = $derived<SectionNavItem[]>(
    [
      { id: 'brains', label: m.nav_brains(), icon: BookOpen, href: '/brains' },
      { id: 'agents', label: m.brains_nav_agents(), icon: Bot, href: '/brains/agents' },
      { id: 'template', label: m.brains_nav_template(), icon: FileText, href: '/brains/template' },
      { id: 'settings', label: m.brains_nav_settings(), icon: Settings, href: '/brains/settings' },
    ].filter(
      (i) =>
        canViewPath(i.href) &&
        (!['template', 'settings'].includes(i.id) || canAct('brains', 'manage')),
    ),
  );

  const pathname = $derived(canonicalPath(page.url.pathname));

  function isActive(id: string, href: string): boolean {
    if (id === 'brains') return pathname === '/brains';
    return pathname.startsWith(href);
  }

  const activeId = $derived(items.find((i) => isActive(i.id, i.href ?? ''))?.id);
</script>

<SectionNav {items} {activeId} ariaLabel={m.nav_brains()} />
