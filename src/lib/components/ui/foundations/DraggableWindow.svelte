<script lang="ts" module>
  export type DraggableWindowVariant = 'default' | 'crt' | 'voxelized' | 'canvas' | 'terminal';
  export type CompactWindowPresentation = 'fullscreen' | 'sheet';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { Grip, Maximize2, Minimize2, X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import Layer from './Layer.svelte';
  import {
    clampWindowRect,
    moveWindowBy,
    resizeWindowBy,
    type WindowRect,
  } from './draggable-window';

  interface Props {
    open?: boolean;
    title: string;
    children: Snippet;
    keyboardInstructions: string;
    resizeLabel?: string;
    variant?: DraggableWindowVariant;
    compactPresentation?: CompactWindowPresentation;
    dismissible?: boolean;
    resizable?: boolean;
    fullscreen?: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    onfocus?: () => void;
    onclose?: () => void;
    onmove?: (x: number, y: number) => void;
    onresize?: (width: number, height: number) => void;
    ontogglefullscreen?: (fullscreen: boolean) => void;
    toolbar?: Snippet;
    class?: string;
  }

  let {
    open = $bindable(true),
    title,
    children,
    keyboardInstructions,
    resizeLabel,
    variant = 'default',
    compactPresentation = 'fullscreen',
    dismissible = true,
    resizable = false,
    fullscreen = $bindable(false),
    x = $bindable(96),
    y = $bindable(80),
    width = $bindable(760),
    height = $bindable(580),
    minWidth = 360,
    minHeight = 280,
    onfocus,
    onclose,
    onmove,
    onresize,
    ontogglefullscreen,
    toolbar,
    class: cls = '',
  }: Props = $props();

  $effect.pre(() => {
    if (resizable && !resizeLabel) {
      throw new Error('Resizable DraggableWindow requires resizeLabel.');
    }
  });

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const instructionsId = `${uid}-instructions`;
  let wide = $state(false);
  let dragging = false;
  let resizing = false;
  let startPointerX = 0;
  let startPointerY = 0;
  let startRect: WindowRect = { x, y, width, height };

  onMount(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const update = () => (wide = media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });

  const presentation = $derived(
    wide ? (fullscreen ? 'fullscreen' : 'floating') : compactPresentation,
  );
  const frameStyle = $derived(
    presentation === 'floating'
      ? `left:${x}px;top:${y}px;width:${width}px;height:${height}px;`
      : '',
  );

  function currentRect(): WindowRect {
    return { x, y, width, height };
  }

  function applyRect(next: WindowRect) {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const clamped = clampWindowRect(next, viewport, { width: minWidth, height: minHeight });
    const moved = clamped.x !== x || clamped.y !== y;
    const resized = clamped.width !== width || clamped.height !== height;
    x = clamped.x;
    y = clamped.y;
    width = clamped.width;
    height = clamped.height;
    if (moved) onmove?.(x, y);
    if (resized) onresize?.(width, height);
  }

  function beginDrag(event: PointerEvent) {
    if (!wide || fullscreen || event.button !== 0) return;
    dragging = true;
    startPointerX = event.clientX;
    startPointerY = event.clientY;
    startRect = currentRect();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function drag(event: PointerEvent) {
    if (!dragging) return;
    applyRect(
      moveWindowBy(startRect, event.clientX - startPointerX, event.clientY - startPointerY),
    );
  }

  function endDrag(event: PointerEvent) {
    dragging = false;
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    }
  }

  function beginResize(event: PointerEvent) {
    if (!wide || fullscreen || !resizable || event.button !== 0) return;
    event.stopPropagation();
    resizing = true;
    startPointerX = event.clientX;
    startPointerY = event.clientY;
    startRect = currentRect();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent) {
    if (!resizing) return;
    applyRect(
      resizeWindowBy(startRect, event.clientX - startPointerX, event.clientY - startPointerY),
    );
  }

  function endResize(event: PointerEvent) {
    resizing = false;
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyboard(event: KeyboardEvent) {
    if (event.key === 'Escape' && dismissible) {
      close();
      return;
    }
    if (!wide || fullscreen || !event.altKey || !event.key.startsWith('Arrow')) return;

    event.preventDefault();
    const step = event.ctrlKey ? 2 : 16;
    const horizontal = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const vertical = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    applyRect(
      event.shiftKey && resizable
        ? resizeWindowBy(currentRect(), horizontal, vertical)
        : moveWindowBy(currentRect(), horizontal, vertical),
    );
  }

  function toggleFullscreen() {
    fullscreen = !fullscreen;
    ontogglefullscreen?.(fullscreen);
  }

  function close() {
    if (!dismissible || !open) return;
    open = false;
    onclose?.();
  }
</script>

{#if open}
  <Layer tier="modal" portal position="fixed" class="draggable-window-layer">
    <div
      data-component="draggable-window"
      data-part="window"
      data-presentation={presentation}
      data-variant={variant}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={instructionsId}
      tabindex="-1"
      style={frameStyle}
      onkeydown={handleKeyboard}
      onpointerdowncapture={onfocus}
      class={cls}
    >
      <header
        data-part="titlebar"
        role="toolbar"
        aria-label={title}
        tabindex="0"
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
        onpointerdown={beginDrag}
        onpointermove={drag}
        onpointerup={endDrag}
        onpointercancel={endDrag}
      >
        <Grip class="window-grip" size={15} aria-hidden="true" />
        <h2 id={titleId}>{title}</h2>
        {#if toolbar}<div data-part="toolbar">{@render toolbar()}</div>{/if}
        {#if wide}
          <button
            type="button"
            onclick={toggleFullscreen}
            aria-label={fullscreen ? m.window_restore() : m.window_fullscreen()}
          >
            {#if fullscreen}<Minimize2 size={15} aria-hidden="true" />{:else}<Maximize2
                size={15}
                aria-hidden="true"
              />{/if}
          </button>
        {/if}
        {#if dismissible}
          <button type="button" onclick={close} aria-label={m.window_close()}>
            <X size={16} aria-hidden="true" />
          </button>
        {/if}
      </header>
      <p id={instructionsId} class="visually-hidden">{keyboardInstructions}</p>
      <div data-part="body">{@render children()}</div>
      {#if wide && !fullscreen && resizable}
        <button
          type="button"
          data-part="resize-handle"
          aria-label={resizeLabel}
          onpointerdown={beginResize}
          onpointermove={resize}
          onpointerup={endResize}
          onpointercancel={endResize}
        ></button>
      {/if}
    </div>
  </Layer>
{/if}

<style>
  [data-component='draggable-window'] {
    position: fixed;
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--color-border-strong, var(--elevation-4-border));
    border-radius: var(--radius-xl);
    color: var(--color-text-primary, var(--color-foreground));
    background: var(--color-overlay, var(--elevation-4-bg));
    box-shadow: var(--shadow-overlay, var(--shadow-xl, var(--shadow-lg)));
    outline: none;
  }
  [data-presentation='fullscreen'] {
    inset: 0;
    border-radius: 0;
  }
  [data-presentation='sheet'] {
    inset: max(10dvh, env(safe-area-inset-top, 0)) 0 0;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }
  [data-part='titlebar'] {
    display: flex;
    min-height: var(--control-height-touch, 44px);
    flex: none;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-1, 4px) var(--space-2, 8px) var(--space-1, 4px) var(--space-3, 12px);
    border-bottom: 1px solid var(--color-border-subtle, var(--hairline));
    user-select: none;
  }
  [data-presentation='floating'] [data-part='titlebar'] {
    cursor: move;
  }
  [data-part='titlebar']:focus-visible,
  [data-component='draggable-window']:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
  .window-grip {
    flex: none;
    color: var(--color-text-tertiary, var(--color-muted-foreground));
  }
  [data-part='titlebar'] h2 {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    font-size: var(--font-size-section-title, 14px);
    line-height: var(--line-height-heading, 20px);
    font-weight: var(--font-weight-semibold, 600);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-part='toolbar'] {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
  }
  [data-part='titlebar'] button {
    display: inline-flex;
    width: var(--control-height-md, 32px);
    height: var(--control-height-md, 32px);
    flex: none;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary, var(--color-muted));
    background: transparent;
  }
  [data-part='titlebar'] button:hover {
    color: var(--color-text-primary, var(--color-foreground));
    background: color-mix(
      in srgb,
      var(--color-text-primary, var(--color-foreground)) 7%,
      transparent
    );
  }
  [data-part='titlebar'] button:focus-visible,
  [data-part='resize-handle']:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  [data-part='body'] {
    min-width: 0;
    min-height: 0;
    flex: 1;
    overflow: auto;
    overscroll-behavior: contain;
  }
  [data-part='resize-handle'] {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--control-height-md, 32px);
    height: var(--control-height-md, 32px);
    border: 0;
    background: linear-gradient(
      135deg,
      transparent 52%,
      var(--color-border-strong, var(--elevation-4-border)) 52%,
      var(--color-border-strong, var(--elevation-4-border)) 58%,
      transparent 58%
    );
    cursor: nwse-resize;
  }
  [data-variant='terminal'] [data-part='body'],
  [data-variant='canvas'] [data-part='body'] {
    font-family: var(--font-family-mono, var(--font-mono));
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  @media (pointer: coarse), (max-width: 767.98px) {
    [data-part='titlebar'] button {
      width: var(--control-height-touch, 44px);
      height: var(--control-height-touch, 44px);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    [data-component='draggable-window'] {
      transition:
        border-radius var(--duration-normal, 250ms) var(--ease-standard),
        box-shadow var(--duration-normal, 250ms) var(--ease-standard);
    }
  }
</style>
