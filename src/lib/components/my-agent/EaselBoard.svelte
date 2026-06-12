<script lang="ts">
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
		type AgentNote
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
		SendToBack
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
				zoom: cam.zoom
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
				h: Math.max(30, drag.oh + dh)
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
			z: topZ() + 1
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
			z: topZ() + 1
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
			Math.max(0.1, Math.min(vw / (maxX - minX + pad * 2), vh / (maxY - minY + pad * 2)))
		);
		setCamera({
			x: vw / 2 - ((minX + maxX) / 2) * zoom,
			y: vh / 2 - ((minY + maxY) / 2) * zoom,
			zoom
		});
	}

	function rawSrc(fileId: string) {
		return `/api/files/${fileId}/raw`;
	}
</script>

<svelte:window onkeydown={onWindowKey} onpaste={onPaste} />

<div class="easel" role="dialog" aria-modal="true" aria-label="Easel board">
	<!-- Toolbar -->
	<div class="toolbar">
		<span class="board-name">
			<input
				value={note.title}
				placeholder="Untitled board"
				oninput={(e) => updateNote(note.id, { title: e.currentTarget.value })}
				aria-label="Board title"
			/>
		</span>
		<div class="tools">
			<button type="button" disabled={busy} title="Add image" onclick={() => fileInput?.click()}>
				<ImagePlus size={15} /> Image
			</button>
			<button type="button" title="Add image from URL" onclick={() => (urlOpen = !urlOpen)}>
				<Link2 size={15} /> URL
			</button>
			<button type="button" title="Add text" onclick={addText}><Type size={15} /> Text</button>
			<button type="button" title="Fit to content" onclick={fitToContent}>
				<Maximize size={15} />
			</button>
			<span class="zoom">{Math.round(cam.zoom * 100)}%</span>
			<button type="button" class="close" title="Close board (Esc)" aria-label="Close" onclick={onclose}>
				<X size={17} />
			</button>
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
			<input type="url" placeholder="Paste image URL…" bind:value={urlValue} aria-label="Image URL" />
			<button type="submit" disabled={busy}>Add</button>
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
							style:color={item.color ?? 'rgba(255,255,255,0.92)'}
						>{item.text}</div>
					{/if}

					{#if selectedId === item.id}
						<button
							type="button"
							class="handle rotate"
							title="Rotate (hold Shift to snap)"
							aria-label="Rotate"
							onpointerdown={(e) => onRotatePointerDown(e, item)}
						></button>
						<button
							type="button"
							class="handle resize"
							title="Resize"
							aria-label="Resize"
							onpointerdown={(e) => onResizePointerDown(e, item)}
						></button>
						<div class="item-tools" onpointerdown={(e) => e.stopPropagation()}>
							<button
								type="button"
								title="Bring to front"
								aria-label="Bring to front"
								onclick={() => updateItem(item.id, { z: topZ() + 1 })}
							>
								<BringToFront size={13} />
							</button>
							<button
								type="button"
								title="Send to back"
								aria-label="Send to back"
								onclick={() => updateItem(item.id, { z: 0 })}
							>
								<SendToBack size={13} />
							</button>
							<button
								type="button"
								class="del"
								title="Delete"
								aria-label="Delete"
								onclick={() => {
									deleteItem(item.id);
									selectedId = null;
								}}
							>
								<Trash2 size={13} />
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if easelItems.length === 0}
			<div class="empty-hint" data-bg="1">
				Drop images, paste, or use the toolbar. Scroll to zoom, drag to pan.
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
		z-index: 80;
		display: flex;
		flex-direction: column;
		background: #0b0b0c;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 14px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.07);
		background: rgba(15, 15, 16, 0.9);
		flex-shrink: 0;
	}
	.board-name input {
		background: transparent;
		border: none;
		outline: none;
		color: rgba(255, 255, 255, 0.92);
		font-size: 14px;
		font-weight: 600;
		font-family: inherit;
		min-width: 180px;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.tools button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 9px;
		font-size: 12px;
		border-radius: 7px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.7);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		transition: color 120ms ease, background 120ms ease;
	}
	.tools button:hover:not(:disabled) {
		color: #fff;
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
	}
	.tools button.close:hover {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.18);
	}
	.zoom {
		font-size: 11.5px;
		color: rgba(255, 255, 255, 0.4);
		min-width: 38px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.url-bar {
		display: flex;
		gap: 8px;
		padding: 8px 14px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.07);
		background: rgba(15, 15, 16, 0.9);
	}
	.url-bar input {
		flex: 1;
		padding: 6px 10px;
		border-radius: 7px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.9);
		outline: none;
		font-family: inherit;
		font-size: 12.5px;
	}
	.url-bar button {
		padding: 6px 12px;
		border-radius: 7px;
		cursor: pointer;
		color: #fff;
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
		background-image:
			radial-gradient(circle, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
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
		border-radius: 4px;
	}
	.item:active {
		cursor: grabbing;
	}
	.item img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		border-radius: 4px;
		user-select: none;
		-webkit-user-drag: none;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
	}
	.item.selected {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.text-item {
		width: 100%;
		height: 100%;
		padding: 6px 8px;
		font-size: 16px;
		line-height: 1.4;
		outline: none;
		overflow: hidden;
		cursor: text;
		word-break: break-word;
		background: rgba(0, 0, 0, 0.15);
		border-radius: 4px;
	}
	.handle.resize {
		position: absolute;
		right: -7px;
		bottom: -7px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-accent);
		border: 2px solid #1a1a1a;
		cursor: nwse-resize;
		padding: 0;
	}
	.handle.rotate {
		position: absolute;
		top: -22px;
		left: 50%;
		width: 13px;
		height: 13px;
		margin-left: -6.5px;
		border-radius: 50%;
		background: var(--color-accent);
		border: 2px solid #1a1a1a;
		cursor: grab;
		padding: 0;
	}
	/* Stem connecting the rotate handle to the item's top edge. */
	.handle.rotate::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 11px;
		width: 1px;
		height: 9px;
		margin-left: -0.5px;
		background: color-mix(in srgb, var(--color-accent) 60%, transparent);
	}
	.handle.rotate:active {
		cursor: grabbing;
	}
	.item-tools {
		position: absolute;
		top: -34px;
		left: 0;
		display: flex;
		gap: 3px;
		padding: 3px;
		border-radius: 8px;
		background: rgba(20, 20, 22, 0.96);
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
	}
	.item-tools button {
		display: inline-flex;
		padding: 4px;
		border-radius: 6px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.7);
		background: transparent;
		border: none;
	}
	.item-tools button:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.1);
	}
	.item-tools button.del:hover {
		color: var(--color-accent);
	}
	.empty-hint {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 13px;
		color: rgba(255, 255, 255, 0.3);
		pointer-events: none;
		text-align: center;
	}
	.hidden-file {
		display: none;
	}
</style>
