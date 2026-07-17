<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { Puzzle, Terminal, Bot, Anchor, Server } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SideNav, type SideNavItem } from '$lib/components/ui';

  const pathname = $derived(canonicalPath(page.url.pathname));

  // 'soon' sections are disabled with a trailing badge (matches the rest of the
  // hub's SideNav usage — CRM/Finance/Settings).
  const items = $derived<SideNavItem[]>([
    { id: 'plugins', label: m.marketplace_plugins(), icon: Puzzle, href: '/marketplace/plugins' },
    { id: 'tools', label: m.marketplace_tools(), icon: Terminal, href: '/marketplace/tools', badge: m.marketplace_comingSoon(), disabled: true },
    { id: 'agents', label: m.marketplace_agents(), icon: Bot, href: '/marketplace/agents' },
    { id: 'hooks', label: m.marketplace_hooks(), icon: Anchor, href: '/marketplace/hooks', badge: m.marketplace_comingSoon(), disabled: true },
    { id: 'mcp-servers', label: m.marketplace_mcpServers(), icon: Server, href: '/marketplace/mcp-servers', badge: m.marketplace_comingSoon(), disabled: true },
  ]);

  const activeId = $derived(
    items.find((i) => i.href && pathname.startsWith(i.href))?.id,
  );
</script>

<SideNav {items} {activeId} ariaLabel={m.marketplace_title()} header={m.marketplace_title()} />
