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
    /** @deprecated Prefer priority-specific action snippets. */
    actions?: Snippet;
    /** Remains visible at every viewport. Keep this to one decisive action. */
    primaryActions?: Snippet;
    /** Inline at medium/wide; wraps at compact unless an overflow menu is supplied. */
    secondaryActions?: Snippet;
    /** Menu trigger for compact secondary actions. */
    overflowActions?: Snippet;
    /** Override the stable heading id used by PageShell's aria-labelledby. */
    titleId?: string;
  }

  let {
    title,
    subtitle,
    sticky = true,
    class: cls = '',
    leading,
    actions,
    primaryActions,
    secondaryActions,
    overflowActions,
    titleId,
  }: Props = $props();

  const uid = $props.id();
  const headingId = $derived(titleId ?? `${uid}-title`);
</script>

<!--
  Sticky title bar. md:pr reserves the top-right notch footprint
  (--notch-clearance) so the header's actions carve around the notch and
  content scrolls under both. See app.css "Notch clearance".
-->
<header
  data-page-header
  data-component="page-header"
  data-part="page-header"
  data-sticky={sticky ? 'true' : undefined}
  data-has-overflow={overflowActions ? 'true' : undefined}
  class={`page-header ${cls}`}
>
  <div class="header-main">
    {#if leading}
      <div data-part="leading">{@render leading()}</div>
    {/if}
    <div data-part="heading">
      <h1 id={headingId}>{title}</h1>
      {#if subtitle}
        <p>{subtitle}</p>
      {/if}
    </div>
    {#if primaryActions}
      <div data-part="primary-actions">{@render primaryActions()}</div>
    {/if}
    {#if secondaryActions || actions}
      <div data-part="secondary-actions">
        {#if secondaryActions}{@render secondaryActions()}{/if}
        {#if actions}{@render actions()}{/if}
      </div>
    {/if}
    {#if overflowActions}
      <div data-part="overflow-actions">{@render overflowActions()}</div>
    {/if}
  </div>
</header>

<style>
  .page-header {
    min-height: var(--page-header-height, 56px);
    flex: none;
    border-bottom: 1px solid var(--color-border-subtle, var(--hairline));
    background: color-mix(in srgb, var(--color-canvas, var(--color-bg)) 82%, transparent);
    backdrop-filter: blur(12px);
  }
  .page-header[data-sticky='true'] {
    position: sticky;
    top: 0;
    z-index: var(--layer-sticky, 10);
  }
  .header-main {
    display: flex;
    min-height: var(--page-header-height, 56px);
    padding: var(--space-2, 8px) var(--space-page-gutter, 16px);
    align-items: center;
    gap: var(--space-3, 12px);
  }
  [data-part='leading'],
  [data-part='primary-actions'],
  [data-part='overflow-actions'] {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-control-gap, 8px);
  }
  [data-part='heading'] {
    min-width: 0;
    flex: 1;
  }
  [data-part='heading'] h1 {
    overflow: hidden;
    color: var(--color-text-primary, var(--color-foreground));
    font-size: var(--font-size-page-title, 18px);
    line-height: var(--line-height-heading, 24px);
    font-weight: var(--font-weight-semibold, 600);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-part='heading'] p {
    margin-top: calc(-1 * var(--space-0-5, 2px));
    overflow: hidden;
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-part='secondary-actions'] {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-control-gap, 8px);
  }

  @media (min-width: 768px) {
    .header-main {
      padding-inline: var(--space-page-gutter, 24px);
      padding-right: max(var(--space-page-gutter, 24px), var(--notch-clearance, 96px));
    }
  }
  @media (min-width: 1280px) {
    .header-main {
      padding-inline: var(--space-page-gutter, 32px);
      padding-right: max(var(--space-page-gutter, 32px), var(--notch-clearance, 96px));
    }
  }
  @media (max-width: 767.98px) {
    .header-main {
      flex-wrap: wrap;
    }
    [data-part='heading'] p {
      display: -webkit-box;
      overflow: hidden;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
    [data-part='secondary-actions'] {
      width: 100%;
      flex-basis: 100%;
      order: 5;
      overflow-x: auto;
      padding-bottom: var(--space-1, 4px);
      scrollbar-width: thin;
    }
    .page-header[data-has-overflow='true'] [data-part='secondary-actions'] {
      display: none;
    }
  }
</style>
