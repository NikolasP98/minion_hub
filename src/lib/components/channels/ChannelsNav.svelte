<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { page } from '$app/state';
  import {
    SectionNav,
    type SectionNavItem,
  } from '$lib/components/ui/foundations';
  import { resolvePluginIcon } from '$lib/plugins/icon-map';
  import * as m from '$lib/paraglide/messages';

  let { channels }: { channels: Array<{ pluginId: string; title: string; icon?: string }> } =
    $props();

  const items = $derived<SectionNavItem[]>(
    channels.map((e) => ({
      id: e.pluginId,
      label: e.title,
      icon: resolvePluginIcon(e.icon),
      href: `/channels/${e.pluginId}`,
    })),
  );

  const activeId = $derived(items.find((i) => canonicalPath(page.url.pathname) === i.href)?.id);
</script>

<SectionNav {items} {activeId} ariaLabel={m.nav_channels()} />
