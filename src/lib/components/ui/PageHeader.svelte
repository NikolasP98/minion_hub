<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    subtitle?: string;
    /** Sticky to the top of the scroll container (content scrolls underneath). */
    sticky?: boolean;
    class?: string;
    /** Leading slot before the title (e.g. a back button or icon). */
    leading?: Snippet;
    /** Right-aligned action cluster. Reserves space for the floating island. */
    actions?: Snippet;
  }

  let { title, subtitle, sticky = true, class: cls = '', leading, actions }: Props = $props();
</script>

<!--
  Sticky title bar. md:pr reserves the top-right notch footprint
  (--notch-clearance) so the header's actions carve around the notch and
  content scrolls under both. See app.css "Notch clearance".
-->
<header
  data-page-header
  class={`page-header ${sticky ? 'sticky top-0 z-30' : ''} shrink-0 flex items-center gap-3
    h-14 px-4 md:px-5 md:pr-[var(--notch-clearance)]
    border-b border-[var(--hairline)] bg-bg/75 backdrop-blur-md ${cls}`}
>
  {#if leading}
    <div class="shrink-0 flex items-center">{@render leading()}</div>
  {/if}
  <div class="min-w-0 flex-1">
    <h1 class="t-heading truncate">{title}</h1>
    {#if subtitle}
      <p class="t-caption truncate -mt-0.5">{subtitle}</p>
    {/if}
  </div>
  {#if actions}
    <div class="shrink-0 flex items-center gap-2">{@render actions()}</div>
  {/if}
</header>
