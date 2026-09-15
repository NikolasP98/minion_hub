<script lang="ts">
  /**
   * ERPNext-style module switcher: the sidebar's top-left control. Picking a
   * module scopes the whole sidebar to that module's pages; "All sections"
   * returns to the full platform nav. Which one a user gets on first load is
   * role-derived (see `navMode`).
   *
   * Collapsed (mini rail) it is NOT a picker: stacking a separate expand
   * button under it wasted the rail's vertical budget, so the same slot doubles
   * as the expand affordance — hovering the sidebar swaps the module icon for
   * the panel icon and a click expands. Picking a module needs the expanded
   * rail.
   */
  import { goto } from '$app/navigation';
  import { ChevronsUpDown, LayoutList, Check, PanelLeft } from 'lucide-svelte';
  import { Button, Dropdown, iconSizes, type DropdownItem } from '$lib/components/ui';
  import { visibleModules } from '$lib/nav/modules';
  import { navMode, navModuleData } from '$lib/state/ui/nav-mode.svelte';
  import { canViewPath } from '$lib/access/can.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    /** Mini-rail rendering: icon only, doubles as the expand affordance. */
    collapsed?: boolean;
    /** Expand the sidebar (mini rail only). */
    onExpand?: () => void;
  }
  let { collapsed = false, onExpand }: Props = $props();

  const FULL = '__full';

  const modules = $derived(visibleModules(navModuleData(), canViewPath));

  const active = $derived(navMode.isModule ? navMode.activeModule : null);
  const ActiveIcon = $derived(active?.icon ?? LayoutList);
  const label = $derived(active?.label ?? m.nav_allSections());

  const items = $derived<DropdownItem[]>([
    ...modules.map((mod) => ({ value: mod.id, label: mod.label, icon: mod.icon })),
    { value: 'div', label: '', divider: true },
    { value: FULL, label: m.nav_allSections(), icon: LayoutList },
  ]);

  function onSelect(value: string) {
    if (value === FULL) {
      navMode.setMode('full');
      return;
    }
    const mod = modules.find((x) => x.id === value);
    if (!mod) return;
    navMode.pickModule(mod.id);
    void goto(mod.href);
  }

  function isSelected(value: string): boolean {
    return value === FULL ? !navMode.isModule : navMode.isModule && active?.id === value;
  }
</script>

{#if collapsed}
  <!-- Mini rail: module icon → expand icon on sidebar hover; click expands. -->
  <Button
    variant="ghost"
    size="xs"
    type="button"
    class="switcher-mini"
    onclick={onExpand}
    aria-label={m.nav_expandSidebar()}
  >
    <span class="mini-icons">
      <ActiveIcon size={iconSizes.md} class="mod-icon shrink-0" />
      <PanelLeft size={iconSizes.md} class="expand-icon shrink-0" />
    </span>
  </Button>
{:else}
  <div class="switcher-wrap">
    <Dropdown {items} {onSelect} placement="bottom" class="min-w-52">
      {#snippet trigger()}
        <span class="switcher">
          <ActiveIcon size={iconSizes.md} class="shrink-0" />
          <span class="t-label switcher-label">{label}</span>
          <ChevronsUpDown size={iconSizes.sm} class="shrink-0 opacity-60" />
        </span>
      {/snippet}
      {#snippet item({ item })}
        {#if item.icon}
          {@const Icon = item.icon}
          <Icon size={iconSizes.sm} class="shrink-0 text-muted-foreground" />
        {/if}
        <span class="flex-1 truncate">{item.label}</span>
        {#if isSelected(item.value)}
          <Check size={iconSizes.sm} class="shrink-0 text-accent" />
        {/if}
      {/snippet}
    </Dropdown>
  </div>
{/if}

<style>
  /* The Dropdown trigger element is inline-flex and shrink-wraps, so the row
     has to be stretched from the outside or the icon drifts off the rail's
     icon column. */
  .switcher-wrap > :global(button) {
    width: 100%;
  }
  .switcher {
    /* Geometry mirrors .nav-row in Sidebar.svelte so the icons share a column. */
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 2.25rem;
    padding: 0 0.625rem;
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    transition: background-color var(--duration-fast) var(--ease-standard);
  }
  .switcher:hover {
    background: var(--color-surface-2);
  }
  .switcher-label {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Mini rail: one 36px square that lines up with the icon-only nav rows. */
  :global(.switcher-mini) {
    width: 100%;
    min-height: 2.25rem;
    justify-content: center;
  }
  .mini-icons {
    display: grid;
    place-items: center;
  }
  /* Both icons occupy the same cell; hovering the sidebar swaps which shows. */
  .mini-icons > :global(*) {
    grid-area: 1 / 1;
  }
  .mini-icons > :global(.expand-icon) {
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  :global(aside:hover) .mini-icons > :global(.expand-icon) {
    opacity: 1;
  }
  :global(aside:hover) .mini-icons > :global(.mod-icon) {
    opacity: 0;
  }
</style>
