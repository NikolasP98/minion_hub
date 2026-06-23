<script lang="ts">
  import { page } from '$app/state';
  import { SideNav, type SideNavItem } from '$lib/components/ui';
  import { resolvePluginIcon } from '$lib/plugins/icon-map';
  import * as m from '$lib/paraglide/messages';

  let { channels }: { channels: Array<{ pluginId: string; title: string; icon?: string }> } =
    $props();

  const items = $derived<SideNavItem[]>(
    channels.map((e) => ({
      id: e.pluginId,
      label: e.title,
      icon: resolvePluginIcon(e.icon),
      href: `/channels/${e.pluginId}`,
    })),
  );

  const activeId = $derived(items.find((i) => page.url.pathname === i.href)?.id);
</script>

<SideNav {items} {activeId} ariaLabel={m.nav_channels()} header={m.nav_channels()} />
