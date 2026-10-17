<script lang="ts">
  import { dev } from '$app/environment';
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
    /**
     * The page's ONE dominant action (spec 013 action scope: `page`). Remains
     * visible at every viewport. A second primary never belongs here — fold it
     * into `secondaryActions` (inline at medium/wide) or `overflowActions`
     * (compact menu). DEV warns when the slot renders more than one element;
     * `action-scope.test.ts` scans the pilot pages.
     */
    primaryActions?: Snippet;
    /** Inline at medium/wide; wraps at compact unless an overflow menu is supplied. */
    secondaryActions?: Snippet;
    /** Menu trigger for compact secondary actions. */
    overflowActions?: Snippet;
    /** Override the stable heading id used by PageShell's aria-labelledby. */
    titleId?: string;
    /** Replaces the plain `<h1>{title}</h1>` with custom markup (e.g. an
     *  inline-editable heading) — receives the stable heading id to apply to
     *  whatever element stands in for it, so `aria-labelledby`/peek title
     *  lookup keeps working. `title` is still required (used for `<svelte:head>`
     *  titles etc.) but is not rendered when this is passed. */
    titleContent?: Snippet<[string]>;
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
    titleContent,
  }: Props = $props();

  const uid = $props.id();
  const headingId = $derived(titleId ?? `${uid}-title`);

  let primaryRegion = $state<HTMLElement | null>(null);
  $effect(() => {
    const count = primaryRegion?.children.length ?? 0;
    if (dev && count > 1) {
      console.warn(
        `[PageHeader] "${title}" renders ${count} primary actions — keep one; fold the rest into secondaryActions/overflowActions.`,
      );
    }
  });
</script>

<!--
  Sticky title bar.
-->
<header
  data-page-header
  data-component="page-header"
  data-part="page-header"
  data-sticky={sticky ? 'true' : undefined}
  data-has-overflow={overflowActions ? 'true' : undefined}
  data-action-scope="page"
  class={`page-header ${cls}`}
>
  <div class="header-main">
    {#if leading}
      <div data-part="leading">{@render leading()}</div>
    {/if}
    <div data-part="heading">
      {#if titleContent}
        {@render titleContent(headingId)}
      {:else}
        <h1 id={headingId}>{title}</h1>
      {/if}
      {#if subtitle}
        <p>{subtitle}</p>
      {/if}
    </div>
    {#if primaryActions}
      <div data-part="primary-actions" bind:this={primaryRegion}>{@render primaryActions()}</div>
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
    }
  }
  @media (min-width: 1280px) {
    .header-main {
      padding-inline: var(--space-page-gutter, 32px);
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
