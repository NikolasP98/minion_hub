<script lang="ts">
  import { navPath } from '$lib/nav/nav-config.svelte';
  import { page } from '$app/state';
  import { SectionNav, type SectionNavItem } from '$lib/components/ui/foundations';
  import { resolvePluginIcon } from '$lib/plugins/icon-map';
  import * as m from '$lib/paraglide/messages';
  import { hasFeature } from '$lib/access/premium';
  import { channelHref } from './channel-href';

  let { channels }: { channels: Array<{ pluginId: string; title: string; icon?: string }> } =
    $props();

  const items = $derived<SectionNavItem[]>(
    channels.map((e) => ({
      id: e.pluginId,
      label: e.title,
      icon: resolvePluginIcon(e.icon),
      href: channelHref(e.pluginId, hasFeature('ai')),
    })),
  );

  const activeId = $derived(items.find((i) => navPath() === i.href)?.id);
</script>

<SectionNav {items} {activeId} ariaLabel={m.nav_channels()} />
