<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SectionNav, type SectionNavItem } from '$lib/components/ui/foundations';
  import { getAreaItems } from '$lib/nav/modules';

  // The KANBAN plugin's detail views. Page list + active matchers come from the
  // module registry ($lib/nav/modules) — the sidebar's Operations module renders
  // the SAME list, so the two can't drift.
  const items = $derived(getAreaItems('workforce'));
  const navItems = $derived<SectionNavItem[]>(
    items.map((i) => ({ id: i.id, label: i.label, icon: i.icon, href: i.href })),
  );

  const pathname = $derived(canonicalPath(page.url.pathname));
  const activeId = $derived(items.find((i) => i.matcher(pathname))?.id);
</script>

<SectionNav items={navItems} {activeId} ariaLabel={m.a11y3_kanbanNav()} />
