<script lang="ts" module>
  export type TagChipOrigin = 'own' | 'contact' | 'product';
</script>

<script lang="ts">
  /**
   * One shared tag pill, replacing the four hand-rolled idioms in
   * `TagsField.svelte`, `crm/[contactId]/+page.svelte`, `EventHoverCard.svelte`
   * and `pos/catalog/+page.svelte` (spec 2026-09-12-erp-core-modules-attachments
   * -recon.md §2.2). Colour is data (`--c` custom property) — never a
   * hardcoded palette.
   */
  import type { Snippet } from 'svelte';
  import { X } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let {
    name,
    color = null,
    size = 'md',
    origin,
    onremove,
    title,
    dashed = false,
    children,
  }: {
    name: string;
    color?: string | null;
    size?: 'sm' | 'md';
    /** Renders a small origin label, like `EventHoverCard`'s per-group headers did. */
    origin?: TagChipOrigin;
    /** Renders the × affordance only when passed. */
    onremove?: () => void;
    title?: string;
    /** Dashed border — used for system/auto-derived tags (e.g. CRM auto-tags). */
    dashed?: boolean;
    /** Optional leading content (e.g. an icon) before the name. */
    children?: Snippet;
  } = $props();

  const originLabel: Record<TagChipOrigin, () => string> = {
    own: m.calendar_tag_origin_own,
    contact: m.calendar_tag_origin_contact,
    product: m.calendar_tag_origin_service,
  };
</script>

<span
  class="tag-chip"
  class:sm={size === 'sm'}
  class:dashed
  style:--c={color ?? 'var(--color-accent)'}
  {title}
>
  {#if children}{@render children()}{/if}
  {name}
  {#if origin}<span class="tag-chip-origin">{originLabel[origin]()}</span>{/if}
  {#if onremove}
    <Button variant="ghost" size="sm" onclick={onremove} aria-label={m.tags_remove()}
      ><X size={iconSizes.xs} /></Button
    >
  {/if}
</span>

<style>
  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--font-size-caption);
    color: var(--c);
    background: color-mix(in srgb, var(--c) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
  }
  .tag-chip.sm {
    padding: var(--space-0-5) var(--space-1);
    font-size: var(--font-size-telemetry);
  }
  .tag-chip.dashed {
    border-style: dashed;
    opacity: 0.92;
  }
  .tag-chip-origin {
    font-size: var(--font-size-telemetry);
    opacity: 0.75;
  }
  .tag-chip :global(button) {
    display: grid;
    place-items: center;
    opacity: 0.7;
  }
  .tag-chip :global(button:hover) {
    opacity: 1;
  }
</style>
