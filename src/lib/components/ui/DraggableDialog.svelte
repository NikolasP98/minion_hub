<script lang="ts" module>
  // Module-scoped so every instance gets a unique id — multiple windows coexist
  // (non-modal), so a per-instance counter would collide on `agent-window-0`.
  let nextId = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as dialog from '@zag-js/dialog';
  import { useMachine, normalizeProps } from '@zag-js/svelte';
  import { Maximize2, Minimize2, X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    title,
    z,
    fullscreen,
    x,
    y,
    onfocus,
    onclose,
    ontogglefullscreen,
    onmove,
    children,
  }: {
    title: string;
    z: number;
    fullscreen: boolean;
    x: number;
    y: number;
    onfocus: () => void;
    onclose: () => void;
    ontogglefullscreen: () => void;
    onmove: (x: number, y: number) => void;
    children: Snippet;
  } = $props();

  const dialogId = `agent-window-${nextId++}`;
  // Non-modal: multiple coexist, background interactive, no scroll-block; we own
  // positioning + drag, Zag handles open/escape/aria.
  const service = useMachine(dialog.machine as any, () => ({
    id: dialogId,
    modal: false,
    closeOnInteractOutside: false,
    preventScroll: false,
    closeOnEscape: true,
    open: true,
    onOpenChange({ open }: { open: boolean }) {
      if (!open) onclose();
    },
  }));
  const api = $derived(dialog.connect(service as any, normalizeProps));

  // ── Drag (title bar) ────────────────────────────────────────────────────
  let dragging = false;
  let startX = 0,
    startY = 0,
    originX = 0,
    originY = 0;

  function onPointerDown(e: PointerEvent) {
    if (fullscreen) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    originX = x;
    originY = y;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const nx = Math.max(0, Math.min(window.innerWidth - 80, originX + (e.clientX - startX)));
    const ny = Math.max(0, Math.min(window.innerHeight - 40, originY + (e.clientY - startY)));
    onmove(nx, ny);
  }
  function onPointerUp(e: PointerEvent) {
    dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  const frameStyle = $derived(
    fullscreen
      ? `position:fixed;inset:0;z-index:${z};`
      : `position:fixed;left:${x}px;top:${y}px;z-index:${z};width:min(760px,92vw);height:min(580px,82vh);`,
  );
</script>

<div {...api.getPositionerProps()} style={frameStyle} onpointerdowncapture={() => onfocus()}>
  <!-- Mirror ui/Modal.svelte's look: surface-4 + radius-xl + hairline borders +
       t-heading title + the same close-button styling (the dialog in the
       reference screenshot). Body is padless so the artifact iframe / flow
       canvas fills edge-to-edge. -->
  <div
    {...api.getContentProps()}
    class="surface-4 flex h-full w-full flex-col overflow-hidden text-foreground shadow-2xl outline-none {fullscreen
      ? 'rounded-none'
      : 'rounded-[var(--radius-xl)]'}"
  >
    <!-- title bar / drag handle -->
    <!-- role="toolbar" exposes the drag-handle row as an interactive widget,
         satisfying the a11y requirement for elements with pointer handlers. -->
    <header
      role="toolbar"
      tabindex="-1"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      class="flex shrink-0 items-center gap-3 border-b border-[var(--hairline)] px-5 py-3.5 {fullscreen
        ? ''
        : 'cursor-move'} select-none"
    >
      <h2 {...api.getTitleProps()} class="t-heading min-w-0 flex-1 truncate">{title}</h2>
      <button
        type="button"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => ontogglefullscreen()}
        aria-label={fullscreen ? m.window_restore() : m.window_fullscreen()}
        class="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-muted-foreground transition-colors duration-[150ms] hover:bg-white/[0.06] hover:text-foreground"
      >
        {#if fullscreen}<Minimize2 size={14} />{:else}<Maximize2 size={14} />{/if}
      </button>
      <button
        type="button"
        {...api.getCloseTriggerProps()}
        onpointerdown={(e) => e.stopPropagation()}
        aria-label={m.window_close()}
        class="-mr-1 flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-muted-foreground transition-colors duration-[150ms] hover:bg-white/[0.06] hover:text-foreground"
      >
        <X size={16} />
      </button>
    </header>
    <div class="min-h-0 flex-1 overflow-hidden">
      {@render children()}
    </div>
  </div>
</div>
