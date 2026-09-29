<script lang="ts">
  /**
   * The one peek host (mounted in the app layout). Reads `page.state.peek`
   * (set by `openRecord`) and renders the target route's own page component
   * inside a Dialog (`modal`) or a right Sheet (`tray`), with an Expand control
   * that turns the peek into the full page. See peek.svelte.ts.
   */
  import { page } from '$app/state';
  import { Maximize2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, Tooltip, iconSizes } from '$lib/components/ui';
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';
  import type { DialogCloseReason } from '$lib/components/ui/foundations/Dialog.svelte';
  import { resolvePeekPage } from './peek-registry';
  import { closePeek, expandPeek, providePeekContext } from './peek.svelte';

  providePeekContext();

  const peek = $derived(page.state.peek);
  const loader = $derived(peek ? resolvePeekPage(peek.href) : null);
  // Bindable mirror of "a peek exists" so the Dialog's own close paths
  // (Escape, backdrop, ✕) flip it and we pop the history entry in `onclose`.
  let open = $state(false);
  $effect(() => {
    open = !!peek && !!loader;
  });

  function onclose(reason: DialogCloseReason) {
    if (reason !== 'programmatic' && page.state.peek) closePeek();
  }

  // Label the dialog with the EMBEDDED page's own heading once it mounts
  // (`h1[id]` from PageHeader, or a `[data-record-title]` marker for a page
  // that renders its title differently) — falls back to the generic caption
  // when neither is found (e.g. the page hasn't painted yet).
  let bodyEl = $state<HTMLDivElement | null>(null);
  let embeddedTitleId = $state<string | null>(null);
  const FALLBACK_TITLE_ID = 'record-peek-title';
  const labelledBy = $derived(embeddedTitleId ?? FALLBACK_TITLE_ID);

  $effect(() => {
    // Re-run whenever the peeked record changes or the body mounts.
    void peek?.href;
    const el = bodyEl;
    if (!el) {
      embeddedTitleId = null;
      return;
    }
    // The embedded page's own effects (title text, etc.) commit in the same
    // microtask pass; a rAF gives them one paint before we look.
    const frame = requestAnimationFrame(() => {
      const heading = el.querySelector<HTMLElement>('h1[id], [data-record-title]');
      if (!heading) {
        embeddedTitleId = null;
        return;
      }
      if (!heading.id) heading.id = 'record-peek-embedded-title';
      embeddedTitleId = heading.id;
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

{#snippet peekHeader()}
  <div class="peek-h">
    <span id="record-peek-title" class="t-caption peek-title">{m.record_peek_title()}</span>
    <Tooltip label={m.record_peek_expand()} asChild>
      {#snippet children(p)}
        <Button
          variant="ghost"
          size="xs"
          {...p}
          aria-label={m.record_peek_expand()}
          onclick={() => peek && expandPeek(peek.href)}
        >
          <Maximize2 size={iconSizes.sm} aria-hidden="true" />
        </Button>
      {/snippet}
    </Tooltip>
  </div>
{/snippet}

{#if peek && loader}
  {#key peek.href}
    <Dialog
      bind:open
      presentation={peek.mode === 'tray' ? 'sheet' : 'dialog'}
      placement="right"
      size="xl"
      class="record-peek"
      header={peekHeader}
      {labelledBy}
      {onclose}
    >
      {#await loader() then { default: Page }}
        <div class="peek-body" bind:this={bodyEl}>
          <Page data={peek.data} />
        </div>
      {/await}
    </Dialog>
  {/key}
{/if}

<style>
  .peek-h {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
  }
  .peek-title {
    color: var(--color-text-secondary);
  }
  /* The page component brings its own PageHeader/PageShell; the peek body is
     the scroll owner so a `scroll="region"` shell inside sizes to content. */
  .peek-body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    view-transition-name: record-peek;
  }
  :global(.record-peek [data-part='body']) {
    padding: 0;
  }
  :global(.record-peek [data-part='header']) {
    padding-block: var(--space-1);
    min-height: 0;
  }
</style>
