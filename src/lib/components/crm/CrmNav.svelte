<script lang="ts">
  import { navPath, navConfig } from '$lib/nav/nav-config.svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SectionNav, type SectionNavItem } from '$lib/components/ui/foundations';
  import { canViewPath } from '$lib/access/can.svelte';
  import { getAreaItems } from '$lib/nav/modules';

  // Page list + active matchers come from the module registry ($lib/nav/modules)
  // — the sidebar's module view renders the SAME list, so the two can't drift.
  const items = $derived(
    getAreaItems('crm', { navConfig: navConfig() }).filter((i) => canViewPath(i.href)),
  );
  const navItems = $derived<SectionNavItem[]>(
    items.map((i) => ({ id: i.id, label: i.label, icon: i.icon, href: i.href, indent: i.indent })),
  );

  const pathname = $derived(navPath());
  const activeId = $derived(items.find((i) => i.matcher(pathname))?.id);
</script>

<SectionNav
  items={navItems}
  {activeId}
  ariaLabel={m.crm_title()}
  collapse={{ href: '/crm', label: m.crm_title() }}
/>
