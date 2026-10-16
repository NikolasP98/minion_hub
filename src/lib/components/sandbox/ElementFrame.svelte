<script lang="ts">
  import { Trash2 } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import { ConfirmDialog } from '$lib/components/ui/foundations';
  import { theme } from '$lib/state/ui/theme.svelte';
  import { buildSrcdoc, readThemeVars } from '$lib/sandbox/srcdoc';
  import { VENDOR } from '$lib/sandbox/vendor';
  import type { SandboxElementRecord, SandboxHost } from '$lib/sandbox/host.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    element: SandboxElementRecord;
    host: SandboxHost;
  }

  let { element, host }: Props = $props();

  let frame = $state<HTMLIFrameElement | null>(null);
  let box = $state<HTMLDivElement | null>(null);
  let confirming = $state(false);

  // Re-reading the live tokens on every theme switch keeps the element's
  // `:root` in step with the hub (the theme state is the reactive dependency).
  const themeVars = $derived.by(() => {
    void theme.presetId;
    void theme.accentId;
    return readThemeVars();
  });

  // A new element record (or `host.reload`) rebuilds the document — that is the
  // whole "hot-load": no compiler, no bundler, just a fresh srcdoc.
  const srcdoc = $derived(
    buildSrcdoc({
      element,
      origin: typeof location === 'undefined' ? '' : location.origin,
      themeVars,
      vendorUrls: VENDOR,
      version: host.versionOf(element.id),
    }),
  );

  $effect(() => (frame ? host.register(frame, element.id) : undefined));

  function post(type: 'theme' | 'resize', payload: unknown) {
    frame?.contentWindow?.postMessage(
      { minion: 1, elementId: element.id, requestId: null, type, payload },
      '*',
    );
  }

  $effect(() => {
    const vars = themeVars;
    post('theme', vars);
  });

  $effect(() => {
    const node = box;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      post('resize', {
        w: Math.round(entry.contentRect.width),
        h: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  });
</script>

<section class="element" style:grid-column={`span ${element.w}`}>
  <header class="element-head">
    <h2 class="t-label element-title">{element.title}</h2>
    <Button
      variant="ghost"
      size="sm"
      aria-label={m.sandbox_remove()}
      onclick={() => (confirming = true)}
    >
      <Trash2 size={iconSizes.sm} />
    </Button>
  </header>
  <div class="element-box" bind:this={box} style:height={`${element.h * 16}rem`}>
    <iframe
      bind:this={frame}
      {srcdoc}
      title={element.title}
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      loading="lazy"
    ></iframe>
  </div>
</section>

<ConfirmDialog
  bind:open={confirming}
  tone="danger"
  title={m.sandbox_remove()}
  message={element.title}
  failureMessage={m.sandbox_remove_failed()}
  onconfirm={() => host.remove(element.id)}
/>

<style>
  .element {
    display: flex;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }
  .element-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-control-gap);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-surface-2);
  }
  .element-title {
    overflow: hidden;
    color: var(--color-text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .element-box {
    position: relative;
    min-height: 0;
    flex: 1;
  }
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>
