<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SectionNav, type SectionNavGroup } from '$lib/components/ui/foundations';
  import { canViewPath } from '$lib/access/can.svelte';
  import ShiftBanner from '$lib/components/pos/ShiftBanner.svelte';
  import { getAreaItems } from '$lib/nav/modules';

  // Page list + active matchers come from the module registry ($lib/nav/modules)
  // — the sidebar's module view renders the SAME list, so the two can't drift.
  const items = $derived(
    getAreaItems('pos', {
      schedulingEnabled: page.data.schedulingEnabled,
      posPendingScheduling: page.data.posPendingScheduling,
    }).filter((i) => canViewPath(i.href)),
  );
  // Same groups as the sidebar's module view (Flows / Setup), badge included.
  const navItems = $derived.by<SectionNavGroup[]>(() => {
    const groups: SectionNavGroup[] = [];
    for (const i of items) {
      const label = i.group ?? '';
      let g = groups.find((x) => x.label === label);
      if (!g) {
        g = { id: label || 'default', label: label || undefined, items: [] };
        groups.push(g);
      }
      g.items.push({ id: i.id, label: i.label, icon: i.icon, href: i.href, badge: i.badge });
    }
    return groups;
  });

  const pathname = $derived(canonicalPath(page.url.pathname));
  const activeId = $derived(items.find((i) => i.matcher(pathname))?.id);
</script>

<SectionNav items={navItems} {activeId} ariaLabel={m.nav_pos()}>
  {#snippet footer()}
    <ShiftBanner />
  {/snippet}
</SectionNav>
