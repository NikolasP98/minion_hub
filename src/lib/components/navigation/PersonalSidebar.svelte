<script lang="ts">
  import { page } from '$app/state';
  import { canonicalPath } from '$lib/canonical-path';
  import { personalSidebar } from '$lib/nav/personal-navigation.svelte';
  import NavIcon from '$lib/components/layout/NavIcon.svelte';
  import { iconSizes, Tooltip } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  let { collapsed = false } = $props<{ collapsed?: boolean }>();
  const sections = $derived(personalSidebar());
</script>

{#each sections as section (section.id)}
  <Tooltip label={section.label} placement="right" disabled={!collapsed} asChild>
    {#snippet children(trigger)}
      <a {...trigger} href={section.href} class="personal-section" aria-label={section.label}>
        <NavIcon icon={section.icon} size={iconSizes.md} />
        {#if !collapsed}<span class="t-label">{section.label}</span>{/if}
      </a>
    {/snippet}
  </Tooltip>
  {#if !collapsed}
    {#each section.items as item (item.id)}
      {@const active = item.activeWhen
        ? item.activeWhen(page.url)
        : item.matcher(canonicalPath(page.url.pathname))}
      <a
        href={item.href}
        class="personal-page t-body"
        class:active
        aria-current={active ? 'page' : undefined}
      >
        <NavIcon icon={item.icon} size={iconSizes.sm} /><span>{item.label}</span>
      </a>
    {/each}
  {/if}
{:else}
  {#if !collapsed}<p class="t-caption personal-hint">{m.nav_noPersonalSections()}</p>{/if}
{/each}

<style>
  .personal-section,
  .personal-page {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--control-height-touch);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
  }
  .personal-section {
    margin-top: var(--space-2);
  }
  .personal-page {
    padding-left: var(--space-6);
    color: var(--color-text-secondary);
  }
  .personal-section span,
  .personal-page span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .personal-section:hover,
  .personal-page:hover {
    background: var(--color-surface-2);
  }
  .personal-page.active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-1));
  }
  .personal-hint {
    color: var(--color-text-secondary);
    padding: var(--space-2);
  }
</style>
