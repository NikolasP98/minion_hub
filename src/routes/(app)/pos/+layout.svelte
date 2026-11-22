<script lang="ts">
  import type { Snippet } from 'svelte';
  import PosNav from '$lib/components/pos/PosNav.svelte';
  import ShiftBanner from '$lib/components/pos/ShiftBanner.svelte';
  import ShiftDialogs from '$lib/components/pos/ShiftDialogs.svelte';
  import { setShiftDialogs } from '$lib/components/pos/shift-dialogs-context';
  import { SectionShell } from '$lib/components/ui/foundations';
  import { navMode } from '$lib/state/ui/nav-mode.svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  setShiftDialogs();

  // In module mode the sidebar already lists the POS pages — rendering the
  // section nav too would duplicate the same four links side by side.
  const navigation = $derived(navMode.isModule ? undefined : posNav);
</script>

{#snippet posNav()}
  <PosNav />
{/snippet}

<!-- `display: contents` keeps the shell a direct flex child of the app frame (height chain
     intact) while giving `:has()` one ancestor above BOTH the strip and the shell. -->
<div class="pos-root">
<!-- The shift control lives in the section nav's footer; without that nav the
     cashier had no way to open a shift, so module mode gets it as a strip. -->
{#if navMode.isModule}
  <div class="shift-strip">
    <ShiftBanner />
  </div>
{/if}

<!-- Outside the nav and the strip: both are hidden on phones, and a native
     <dialog> under a hidden ancestor paints nothing but still blocks the page. -->
<ShiftDialogs />

<SectionShell mode="responsive" {navigation}>
  {@render children()}
</SectionShell>
</div>

<style>
  .pos-root {
    display: contents;
  }
  /* Phone calendar (spec 145): the page owns the whole screen — nav row and strip hide, stay mounted. */
  .pos-root:has(:global(.is-compact-calendar)) .shift-strip,
  .pos-root:has(:global(.is-compact-calendar)) :global([data-part='section-navigation']) {
    display: none;
  }
  .shift-strip {
    flex-shrink: 0;
    border-bottom: 1px solid var(--hairline);
    background: var(--color-surface-1);
  }
  /* The banner's ≥xl variant is a vertical sidebar card; as a full-width strip
     it reads as a row. (Forwarded-class rule: the markup is inside the child
     component, so it needs :global under this scoped ancestor.) */
  .shift-strip :global(.box) {
    flex-direction: row;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-page-gutter, 24px);
  }
</style>
