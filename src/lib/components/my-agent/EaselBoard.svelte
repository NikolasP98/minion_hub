<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import {
    addEaselItem as _addEasel,
    updateEaselItem as _updEasel,
    deleteEaselItem as _delEasel,
    setEaselCamera as _setCam,
    topEaselZ as _topZ,
    addBlockEaselItem,
    updateBlockEaselItem,
    deleteBlockEaselItem,
    setBlockEaselCamera,
    topBlockEaselZ,
    uploadNoteImage,
    fetchImageFromUrl,
    updateNote,
    type AgentNote,
  } from '$lib/state/features/agent-notes.svelte';
  import type { EaselItem, EaselBlock } from '$lib/types/notes';
  import {
    X,
    ImagePlus,
    Link2,
    Type,
    Trash2,
    Maximize,
    BringToFront,
    SendToBack,
  } from 'lucide-svelte';

  // `block` set → editing an embedded easel block; otherwise a legacy standalone easel.
  let { note, block, onclose }: { note: AgentNote; block?: EaselBlock; onclose: () => void } =
    $props();

  let stage = $state<HTMLDivElement | null>(null);
  let selectedId = $state<string | null>(null);
  let urlOpen = $state(false);
  let urlValue = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);
  let busy = $state(false);

  // Source data + op wrappers — route to block-scoped or legacy mutations.
  const easelItems = $derived(block ? block.items : note.easel.items);
  const cam = $derived((block ? block.camera : note.easel.camera) ?? { x: 0, y: 0, zoom: 1 });
  const addItem = (it: EaselItem) =>
    block ? addBlockEaselItem(note.id, block.id, it) : _addEasel(note.id, it);
  const updateItem = (id: string, patch: Partial<EaselItem>) =>
    block ? updateBlockEaselItem(note.id, block.id, id, patch) : _updEasel(note.id, id, patch);
  const deleteItem = (id: string) =>
    block ? deleteBlockEaselItem(note.id, block.id, id) : _delEasel(note.id, id);
  const setCamera = (c: { x: number; y: number; zoom: number }) =>
    block ? setBlockEaselCamera(note.id, block.id, c) : _setCam(note.id, c);
  const topZ = () => (block ? topBlockEaselZ(block) : _topZ(note));

  // Active pointer gesture.
  type Drag =
    | { mode: 'pan'; sx: number; sy: number; camx: number; camy: number }
    | { mode: 'move'; id: string; sx: number; sy: number; ox: number; oy: number }
    | {
        mode: 'resize';
        id: string;
        sx: number;
        sy: number;
        ow: number;
        oh: number;
      }
    | { mode: 'rotate'; id: string; cx: number; cy: number }
    | null;
  let drag: Drag = null;

  function screenToWorld(clientX: number, clientY: number) {
    const rect = stage?.getBoundingClientRect();
    const px = clientX - (rect?.left ?? 0);
    const py = clientY - (rect?.top ?? 0);
    return { x: (px - cam.x) / cam.zoom, y: (py - cam.y) / cam.zoom };
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = stage?.getBoundingClientRect();
    const px = e.clientX - (rect?.left ?? 0);
    const py = e.clientY - (rect?.top ?? 0);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(4, Math.max(0.1, cam.zoom * factor));
    // Keep the point under the cursor stationary.
    const wx = (px - cam.x) / cam.zoom;
    const wy = (py - cam.y) / cam.zoom;
    setCamera({ x: px - wx * newZoom, y: py - wy * newZoom, zoom: newZoom });
  }

  function onStagePointerDown(e: PointerEvent) {
    if (e.button === 1 || e.target === stage || (e.target as HTMLElement).dataset.bg === '1') {
      selectedId = null;
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, camx: cam.x, camy: cam.y };
      stage?.setPointerCapture(e.pointerId);
    }
  }

  function onItemPointerDown(e: PointerEvent, item: EaselItem) {
    e.stopPropagation();
    selectedId = item.id;
    // Bring to front on grab.
    updateItem(item.id, { z: topZ() + 1 });
    drag = { mode: 'move', id: item.id, sx: e.clientX, sy: e.clientY, ox: item.x, oy: item.y };
    stage?.setPointerCapture(e.pointerId);
  }

  function onResizePointerDown(e: PointerEvent, item: EaselItem) {
    e.stopPropagation();
    selectedId = item.id;
    drag = { mode: 'resize', id: item.id, sx: e.clientX, sy: e.clientY, ow: item.w, oh: item.h };
    stage?.setPointerCapture(e.pointerId);
  }

  function onRotatePointerDown(e: PointerEvent, item: EaselItem) {
    e.stopPropagation();
    selectedId = item.id;
    // Capture the item's centre in screen coords; cam + geometry are fixed
    // for the duration of the rotate gesture, so this stays accurate.
    const rect = stage?.getBoundingClientRect();
    const cx = (rect?.left ?? 0) + cam.x + (item.x + item.w / 2) * cam.zoom;
    const cy = (rect?.top ?? 0) + cam.y + (item.y + item.h / 2) * cam.zoom;
    drag = { mode: 'rotate', id: item.id, cx, cy };
    stage?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (drag.mode === 'pan') {
      setCamera({
        x: drag.camx + (e.clientX - drag.sx),
        y: drag.camy + (e.clientY - drag.sy),
        zoom: cam.zoom,
      });
    } else if (drag.mode === 'move') {
      const dx = (e.clientX - drag.sx) / cam.zoom;
      const dy = (e.clientY - drag.sy) / cam.zoom;
      updateItem(drag.id, { x: drag.ox + dx, y: drag.oy + dy });
    } else if (drag.mode === 'resize') {
      const dw = (e.clientX - drag.sx) / cam.zoom;
      const dh = (e.clientY - drag.sy) / cam.zoom;
      updateItem(drag.id, {
        w: Math.max(40, drag.ow + dw),
        h: Math.max(30, drag.oh + dh),
      });
    } else if (drag.mode === 'rotate') {
      // Angle from item centre to pointer; +90 so the handle (which sits
      // directly above the item) maps to 0°. Hold Shift to snap to 15°.
      let deg = (Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      updateItem(drag.id, { rotation: Math.round(deg) });
    }
  }

  function onPointerUp(e: PointerEvent) {
    drag = null;
    try {
      stage?.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  }

  // ── Adding items ──

  function placeAt(): { x: number; y: number } {
    // Centre of the current viewport in world coords.
    const rect = stage?.getBoundingClientRect();
    const cx = (rect?.width ?? 800) / 2;
    const cy = (rect?.height ?? 600) / 2;
    return { x: (cx - cam.x) / cam.zoom, y: (cy - cam.y) / cam.zoom };
  }

  function newId() {
    try {
      return crypto.randomUUID();
    } catch {
      return `e_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    }
  }

  function addText() {
    const p = placeAt();
    const item: EaselItem = {
      id: newId(),
      type: 'text',
      text: 'Text',
      x: p.x - 80,
      y: p.y - 20,
      w: 160,
      h: 48,
      rotation: 0,
      z: topZ() + 1,
    };
    addItem(item);
    selectedId = item.id;
  }

  function addImageItem(fileId: string, w = 240, h = 180) {
    const p = placeAt();
    const item: EaselItem = {
      id: newId(),
      type: 'image',
      fileId,
      x: p.x - w / 2,
      y: p.y - h / 2,
      w,
      h,
      rotation: 0,
      z: topZ() + 1,
    };
    addItem(item);
    selectedId = item.id;
  }

  async function ingestFiles(files: FileList | null | undefined) {
    if (!files) return;
    busy = true;
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const fileId = await uploadNoteImage(file);
        addImageItem(fileId);
      }
    } catch {
      /* ignore */
    } finally {
      busy = false;
    }
  }

  async function submitUrl() {
    const url = urlValue.trim();
    if (!url) return;
    busy = true;
    try {
      const fileId = await fetchImageFromUrl(url);
      addImageItem(fileId);
      urlValue = '';
      urlOpen = false;
    } catch {
      /* ignore */
    } finally {
      busy = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    void ingestFiles(e.dataTransfer?.files);
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (selectedId) selectedId = null;
      else onclose();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      const active = document.activeElement as HTMLElement | null;
      if (active?.isContentEditable || active?.tagName === 'INPUT') return;
      deleteItem(selectedId);
      selectedId = null;
    }
  }

  async function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (!it.type.startsWith('image/')) continue;
      const file = it.getAsFile();
      if (!file) continue;
      e.preventDefault();
      busy = true;
      try {
        const fileId = await uploadNoteImage(file);
        addImageItem(fileId);
      } finally {
        busy = false;
      }
    }
  }

  function fitToContent() {
    const items = easelItems;
    const rect = stage?.getBoundingClientRect();
    const vw = rect?.width ?? 800;
    const vh = rect?.height ?? 600;
    if (items.length === 0) {
      setCamera({ x: vw / 2, y: vh / 2, zoom: 1 });
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + it.w);
      maxY = Math.max(maxY, it.y + it.h);
    }
    const pad = 60;
    const zoom = Math.min(
      4,
      Math.max(0.1, Math.min(vw / (maxX - minX + pad * 2), vh / (maxY - minY + pad * 2))),
    );
    setCamera({
      x: vw / 2 - ((minX + maxX) / 2) * zoom,
      y: vh / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    });
  }

  function rawSrc(fileId: string) {
    return `/api/files/${fileId}/raw`;
  }
</script>

<svelte:window onkeydown={onWindowKey} onpaste={onPaste} />

<div class="easel" role="dialog" aria-modal="true" aria-label={m.a11y4_easelBoard()}>
  <!-- Toolbar -->
  <div class="toolbar">
    <span class="board-name">
      <input
        value={note.title}
        placeholder={m.easel_untitledBoard()}
        oninput={(e) => updateNote(note.id, { title: e.currentTarget.value })}
        aria-label={m.easel_boardTitle()}
      />
    </span>
    <div class="tools">
      <Button
        type="button"
        disabled={busy}
        title={m.easel_addImage()}
        onclick={() => fileInput?.click()}
      >
        <ImagePlus size={15} />
        {m.easel_image()}
      </Button>
      <Button type="button" title={m.easel_addImageFromUrl()} onclick={() => (urlOpen = !urlOpen)}>
        <Link2 size={15} />
        {m.easel_url()}
      </Button>
      <Button type="button" title={m.easel_addText()} onclick={addText}
        ><Type size={15} /> {m.easel_text()}</Button
      >
      <Button type="button" title={m.easel_fitToContent()} onclick={fitToContent}>
        <Maximize size={15} />
      </Button>
      <span class="zoom">{Math.round(cam.zoom * 100)}%</span>
      <Button
        type="button"
        class="close"
        title={m.easel_closeBoardEsc()}
        aria-label={m.common_close()}
        onclick={onclose}
      >
        <X size={17} />
      </Button>
    </div>
  </div>

  {#if urlOpen}
    <form
      class="url-bar"
      onsubmit={(e) => {
        e.preventDefault();
        void submitUrl();
      }}
    >
      <input
        type="url"
        placeholder={m.easel_pasteImageUrl()}
        bind:value={urlValue}
        aria-label={m.easel_imageUrl()}
      />
      <Button type="submit" disabled={busy}>{m.common_add()}</Button>
    </form>
  {/if}

  <!-- Canvas -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="stage"
    bind:this={stage}
    onpointerdown={onStagePointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onwheel={onWheel}
    ondragover={(e) => e.preventDefault()}
    ondrop={onDrop}
  >
    <div class="bg-grid" data-bg="1"></div>
    <div class="world" style:transform={`translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`}>
      {#each easelItems as item (item.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="item"
          class:selected={selectedId === item.id}
          style:left={`${item.x}px`}
          style:top={`${item.y}px`}
          style:width={`${item.w}px`}
          style:height={`${item.h}px`}
          style:z-index={item.z}
          style:transform={`rotate(${item.rotation}deg)`}
          onpointerdown={(e) => onItemPointerDown(e, item)}
        >
          {#if item.type === 'image'}
            <img src={rawSrc(item.fileId)} alt="" draggable="false" />
          {:else}
            <div
              class="text-item"
              contenteditable="plaintext-only"
              onpointerdown={(e) => e.stopPropagation()}
              onblur={(e) => updateItem(item.id, { text: e.currentTarget.textContent ?? '' })}
              style:color={item.color ??
                'color-mix(in srgb, var(--color-foreground) 92%, transparent)'}
            >
              {item.text}
            </div>
          {/if}

          {#if selectedId === item.id}
            <Button
              type="button"
              class="handle rotate"
              title={m.easel_rotateHoldShiftSnap()}
              aria-label={m.easel_rotate()}
              onpointerdown={(e: PointerEvent) => onRotatePointerDown(e, item)}
            ></Button>
            <Button
              type="button"
              class="handle resize"
              title={m.easel_resize()}
              aria-label={m.easel_resize()}
              onpointerdown={(e: PointerEvent) => onResizePointerDown(e, item)}
            ></Button>
            <div class="item-tools" onpointerdown={(e) => e.stopPropagation()}>
              <Button
                type="button"
                title={m.easel_bringToFront()}
                aria-label={m.easel_bringToFront()}
                onclick={() => updateItem(item.id, { z: topZ() + 1 })}
              >
                <BringToFront size={13} />
              </Button>
              <Button
                type="button"
                title={m.easel_sendToBack()}
                aria-label={m.easel_sendToBack()}
                onclick={() => updateItem(item.id, { z: 0 })}
              >
                <SendToBack size={13} />
              </Button>
              <Button
                type="button"
                class="del"
                title={m.common_delete()}
                aria-label={m.common_delete()}
                onclick={() => {
                  deleteItem(item.id);
                  selectedId = null;
                }}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if easelItems.length === 0}
      <div class="empty-hint" data-bg="1">
        {m.easel_emptyHint()}
      </div>
    {/if}
  </div>

  <input
    bind:this={fileInput}
    type="file"
    accept="image/*"
    multiple
    class="hidden-file"
    onchange={(e) => {
      void ingestFiles(e.currentTarget.files);
      e.currentTarget.value = '';
    }}
  />
</div>

<style>
  .easel {
    position: fixed;
    inset: 0;
    z-index: var(--layer-debug);
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid color-mix(in srgb, var(--color-foreground) 7%, transparent);
    background: color-mix(in srgb, var(--color-bg2) 90%, transparent);
    flex-shrink: 0;
  }
  .board-name input {
    background: transparent;
    border: none;
    outline: none;
    color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
    font-size: var(--font-size-body);
    font-weight: 600;
    font-family: inherit;
    min-width: 180px;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .tools :global([data-part='button']) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-caption);
    border-radius: var(--radius-lg);
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  .tools :global([data-part='button']):hover:not(:disabled) {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
  }
  .tools :global([data-part='button']):global(.close):hover {
    background: color-mix(in srgb, var(--color-foreground) 12%, transparent);
    border-color: color-mix(in srgb, var(--color-foreground) 18%, transparent);
  }
  .zoom {
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
    min-width: 38px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .url-bar {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid color-mix(in srgb, var(--color-foreground) 7%, transparent);
    background: color-mix(in srgb, var(--color-bg2) 90%, transparent);
  }
  .url-bar input {
    flex: 1;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
    color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
    outline: none;
    font-family: inherit;
    font-size: var(--font-size-caption);
  }
  .url-bar :global([data-part='button']) {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-lg);
    cursor: pointer;
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-accent) 22%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
  }
  .stage {
    position: relative;
    flex: 1;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
  }
  .stage:active {
    cursor: grabbing;
  }
  .bg-grid {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, var(--color-foreground) 6%, transparent) 1px,
      transparent 1px
    );
    background-size: 26px 26px;
    pointer-events: none;
  }
  .world {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    width: 0;
    height: 0;
  }
  .item {
    position: absolute;
    cursor: grab;
    border-radius: var(--radius-sm);
  }
  .item:active {
    cursor: grabbing;
  }
  .item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: var(--radius-sm);
    user-select: none;
    -webkit-user-drag: none;
    box-shadow: var(--shadow-elevation-2);
  }
  .item.selected {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .text-item {
    width: 100%;
    height: 100%;
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-page-title);
    line-height: 1.4;
    outline: none;
    overflow: hidden;
    cursor: text;
    word-break: break-word;
    background: color-mix(in srgb, var(--color-bg) 15%, transparent);
    border-radius: var(--radius-sm);
  }
  :global(.handle):global(.resize) {
    position: absolute;
    right: -7px;
    bottom: -7px;
    width: 14px;
    height: 14px;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    border: 2px solid var(--color-bg2);
    cursor: nwse-resize;
    padding: 0;
  }
  :global(.handle):global(.rotate) {
    position: absolute;
    top: -22px;
    left: 50%;
    width: 13px;
    height: 13px;
    margin-left: calc(-1 * var(--space-2));
    border-radius: var(--radius-full);
    background: var(--color-accent);
    border: 2px solid var(--color-bg2);
    cursor: grab;
    padding: 0;
  }
  /* Stem connecting the rotate handle to the item's top edge. */
  :global(.handle):global(.rotate)::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 11px;
    width: 1px;
    height: 9px;
    margin-left: calc(-0.25 * var(--space-0-5));
    background: color-mix(in srgb, var(--color-accent) 60%, transparent);
  }
  :global(.handle):global(.rotate):active {
    cursor: grabbing;
  }
  .item-tools {
    position: absolute;
    top: -34px;
    left: 0;
    display: flex;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-bg2) 96%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);
    box-shadow: var(--shadow-elevation-2);
  }
  .item-tools :global([data-part='button']) {
    display: inline-flex;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
    background: transparent;
    border: none;
  }
  .item-tools :global([data-part='button']):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 10%, transparent);
  }
  .item-tools :global([data-part='button']):global(.del):hover {
    color: var(--color-accent);
  }
  .empty-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: var(--font-size-body);
    color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
    pointer-events: none;
    text-align: center;
  }
  .hidden-file {
    display: none;
  }
</style>
