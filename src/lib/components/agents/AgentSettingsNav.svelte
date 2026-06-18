<script lang="ts">
  import {
    Blocks,
    User,
    Brain,
    Wrench,
    Shield,
    Activity,
    Settings,
    Sliders,
    Database,
    Layers,
    Link,
    Search,
  } from 'lucide-svelte';
  import type { ResolvedGroup, ResolvedField } from '$lib/utils/agent-settings-schema';
  import * as m from '$lib/paraglide/messages';
  import { SideNav, type SideNavGroup } from '$lib/components/ui';

  const GROUP_ICONS: Record<string, typeof User> = {
    identity: User,
    model: Brain,
    workspace: Database,
    'memory-search': Search,
    'context-pruning': Layers,
    compaction: Layers,
    behavior: Activity,
    'tool-profile': Wrench,
    sandbox: Shield,
    session: Sliders,
    advanced: Settings,
  };

  let {
    activeSection,
    onselect,
    groups,
    enabledSkillCount = 0,
    totalSkillCount = 0,
    bindingCount = 0,
    searchQuery = $bindable(''),
  }: {
    activeSection: string;
    onselect: (id: string) => void;
    groups: ResolvedGroup[];
    enabledSkillCount?: number;
    totalSkillCount?: number;
    bindingCount?: number;
    searchQuery?: string;
  } = $props();

  function countOverrides(fields: ResolvedField[]): number {
    return fields.filter((f) => f.isOverridden).length;
  }

  // Skills (top), the dynamic settings groups (middle), Bindings (bottom) — each its
  // own section so SideNav draws the dividers between them.
  const navGroups = $derived.by<SideNavGroup[]>(() => {
    const out: SideNavGroup[] = [];
    out.push({
      items: [
        {
          id: 'skills',
          label: m.skills_title(),
          icon: Blocks,
          badge: totalSkillCount > 0 ? `${enabledSkillCount}/${totalSkillCount}` : undefined,
        },
      ],
    });
    out.push({
      label: m.settings_title(),
      items: groups.map(({ group, fields }) => {
        const overrides = countOverrides(fields);
        return {
          id: group.id,
          label: group.label,
          icon: GROUP_ICONS[group.id] ?? Settings,
          badge: overrides > 0 ? overrides : undefined,
          // Surface a group when a nested field label/help matches the search.
          keywords: fields.map((f) => `${f.hint?.label ?? f.key} ${f.hint?.help ?? ''}`).join(' '),
        };
      }),
    });
    if (bindingCount > 0) {
      out.push({
        items: [{ id: 'bindings', label: m.config_bindingsSection(), icon: Link, badge: bindingCount }],
      });
    }
    return out;
  });
</script>

<SideNav
  items={navGroups}
  activeId={activeSection}
  ariaLabel={m.settings_title()}
  search={{ enabled: true, placeholder: m.settings_searchPlaceholder() }}
  bind:searchQuery
  onSelect={onselect}
  leftBorder
/>
