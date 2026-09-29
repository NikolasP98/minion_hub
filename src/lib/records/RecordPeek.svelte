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
  import { Button, Tooltip } from '$lib/components/ui';
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
</script>

{#snippet peekHeader()}
  <div class="peek-h">
    <Tooltip label={m.record_peek_expand()} asChild>
      {#snippet children(p)}
        <Button
          variant="ghost"
          size="xs"
          {...p}
          aria-label={m.record_peek_expand()}
          onclick={() => peek && expandPeek(peek.href)}
        >
          <Maximize2 size={14} aria-hidden="true" />
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
      {onclose}
    >
      {#await loader() then { default: Page }}
        <div class="peek-body">
          <Page data={peek.data} />
        </div>
      {/await}
    </Dialog>
  {/key}
{/if}

<style>
  .peek-h {
    display: flex;
    justify-content: flex-end;
    flex: 1;
    min-width: 0;
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
