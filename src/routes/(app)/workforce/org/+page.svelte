<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	type OrgNode = { id: string; name: string; role: string; status: string; reports: OrgNode[] };
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import { PageHeader } from '$lib/components/ui';
	import { Network } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();
	const { tree, agents } = $derived(data);

	const CARD_W = 220;
	const CARD_H = 96;
	const GAP_X = 36;
	const GAP_Y = 72;
	const PADDING = 48;

	type LayoutNode = {
		id: string;
		name: string;
		role: string;
		status: string;
		x: number;
		y: number;
		children: LayoutNode[];
	};

	function subtreeWidth(node: OrgNode): number {
		if (node.reports.length === 0) return CARD_W;
		const childrenW = node.reports.reduce((s: number, c: OrgNode) => s + subtreeWidth(c), 0);
		const gaps = (node.reports.length - 1) * GAP_X;
		return Math.max(CARD_W, childrenW + gaps);
	}

	function layoutTree(node: OrgNode, x: number, y: number): LayoutNode {
		const totalW = subtreeWidth(node);
		const layoutChildren: LayoutNode[] = [];
		if (node.reports.length > 0) {
			const childrenW = node.reports.reduce((s: number, c: OrgNode) => s + subtreeWidth(c), 0);
			const gaps = (node.reports.length - 1) * GAP_X;
			let cx = x + (totalW - childrenW - gaps) / 2;
			for (const child of node.reports) {
				const cw = subtreeWidth(child);
				layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y));
				cx += cw + GAP_X;
			}
		}
		return {
			id: node.id,
			name: node.name,
			role: node.role,
			status: node.status,
			x: x + (totalW - CARD_W) / 2,
			y,
			children: layoutChildren,
		};
	}

	function layoutForest(roots: OrgNode[]): LayoutNode[] {
		let x = PADDING;
		const y = PADDING;
		const result: LayoutNode[] = [];
		for (const root of roots) {
			const w = subtreeWidth(root);
			result.push(layoutTree(root, x, y));
			x += w + GAP_X;
		}
		return result;
	}

	function flatten(nodes: LayoutNode[]): LayoutNode[] {
		const out: LayoutNode[] = [];
		const walk = (n: LayoutNode) => {
			out.push(n);
			n.children.forEach(walk);
		};
		nodes.forEach(walk);
		return out;
	}

	function collectEdges(nodes: LayoutNode[]): Array<{ p: LayoutNode; c: LayoutNode }> {
		const edges: Array<{ p: LayoutNode; c: LayoutNode }> = [];
		const walk = (n: LayoutNode) => {
			for (const c of n.children) {
				edges.push({ p: n, c });
				walk(c);
			}
		};
		nodes.forEach(walk);
		return edges;
	}

	const layout = $derived(layoutForest(tree));
	const allNodes = $derived(flatten(layout));
	const edges = $derived(collectEdges(layout));
	const agentMap = $derived(new Map(agents.map((a) => [a.id, a])));

	const bounds = $derived.by(() => {
		if (allNodes.length === 0) return { w: 800, h: 600 };
		let maxX = 0;
		let maxY = 0;
		for (const n of allNodes) {
			if (n.x + CARD_W > maxX) maxX = n.x + CARD_W;
			if (n.y + CARD_H > maxY) maxY = n.y + CARD_H;
		}
		return { w: maxX + PADDING, h: maxY + PADDING };
	});

	// Pan & zoom
	let container: HTMLDivElement;
	let pan = $state({ x: 0, y: 0 });
	let zoom = $state(1);
	let dragging = $state(false);
	let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };
	let initialized = false;

	function fitToScreen() {
		if (!container) return;
		const cW = container.clientWidth;
		const cH = container.clientHeight;
		const fitZoom = Math.min((cW - 40) / bounds.w, (cH - 40) / bounds.h, 1);
		const chartW = bounds.w * fitZoom;
		const chartH = bounds.h * fitZoom;
		zoom = fitZoom;
		pan = { x: (cW - chartW) / 2, y: (cH - chartH) / 2 };
	}

	function zoomIn() {
		applyZoom(zoom * 1.2);
	}
	function zoomOut() {
		applyZoom(zoom * 0.8);
	}
	function applyZoom(target: number) {
		const next = Math.max(0.2, Math.min(2, target));
		if (!container) {
			zoom = next;
			return;
		}
		const cx = container.clientWidth / 2;
		const cy = container.clientHeight / 2;
		const scale = next / zoom;
		pan = { x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) };
		zoom = next;
	}

	function onMouseDown(e: MouseEvent) {
		dragging = true;
		dragStart = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
	}
	function onMouseMove(e: MouseEvent) {
		if (!dragging) return;
		pan = {
			x: dragStart.panX + (e.clientX - dragStart.x),
			y: dragStart.panY + (e.clientY - dragStart.y),
		};
	}
	function onMouseUp() {
		dragging = false;
	}
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const factor = e.deltaY < 0 ? 1.1 : 0.9;
		const next = Math.max(0.2, Math.min(2, zoom * factor));
		const scale = next / zoom;
		pan = { x: mx - scale * (mx - pan.x), y: my - scale * (my - pan.y) };
		zoom = next;
	}

	onMount(() => {
		const stop = startPolling('app:org', 8000);
		// Fit on first paint
		requestAnimationFrame(() => {
			if (!initialized) {
				fitToScreen();
				initialized = true;
			}
		});
		return stop;
	});

	const STATUS_DOT: Record<string, string> = {
		active: '#10b981',
		running: '#3b82f6',
		paused: '#f59e0b',
		error: '#ef4444',
		idle: '#6b7280',
	};

	function dotColor(status: string): string {
		return STATUS_DOT[status] ?? '#6b7280';
	}

	function statusLabel(status: string): string {
		switch (status) {
			case 'active':
				return m.workforce_status_active();
			case 'running':
				return m.workforce_status_running();
			case 'paused':
				return m.workforce_status_paused();
			case 'error':
				return m.workforce_status_error();
			case 'idle':
				return m.workforce_status_idle();
			default:
				return status;
		}
	}

	function roleLabel(role: string): string {
		return role.charAt(0).toUpperCase() + role.slice(1).replaceAll('_', ' ');
	}
</script>

<PageHeader title={m.workforce_orgChart()}>
	{#snippet leading()}
		<Network size={16} class="text-accent shrink-0" />
	{/snippet}
	{#snippet actions()}
		<LiveIndicator intervalMs={8000} />
		<div class="hidden md:block text-xs text-muted-foreground">
			{m.workforce_orgChartInfo({ count: allNodes.length })}
		</div>
	{/snippet}
</PageHeader>
<main class="flex-1 min-h-0 flex flex-col p-6 gap-3 overflow-hidden">
	<div
		bind:this={container}
		role="presentation"
		class="relative flex-1 min-h-0 overflow-hidden rounded-lg border border-border bg-muted/20"
		class:cursor-grab={!dragging}
		class:cursor-grabbing={dragging}
		onmousedown={onMouseDown}
		onmousemove={onMouseMove}
		onmouseup={onMouseUp}
		onmouseleave={onMouseUp}
		onwheel={onWheel}
	>
		<!-- Zoom controls -->
		<div class="absolute top-3 right-3 z-10 flex flex-col gap-1">
			<button
				class="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-muted transition-colors"
				onclick={zoomIn}
				aria-label={m.workforce_zoomIn()}
				type="button"
			>
				+
			</button>
			<button
				class="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-muted transition-colors"
				onclick={zoomOut}
				aria-label={m.workforce_zoomOut()}
				type="button"
			>
				−
			</button>
			<button
				class="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-[10px] hover:bg-muted transition-colors"
				onclick={fitToScreen}
				title={m.workforce_fitToScreen()}
				aria-label={m.workforce_fitChartToScreen()}
				type="button"
			>
				{m.workforce_fit()}
			</button>
		</div>

		<!-- Zoom % readout -->
		<div class="absolute bottom-3 right-3 z-10 text-xs text-muted-foreground bg-background/80 backdrop-blur rounded px-2 py-1 font-mono">
			{Math.round(zoom * 100)}%
		</div>

		<!-- Edges (SVG) -->
		<svg class="absolute inset-0 pointer-events-none w-full h-full">
			<g transform="translate({pan.x}, {pan.y}) scale({zoom})">
				{#each edges as edge (`${edge.p.id}-${edge.c.id}`)}
					{@const x1 = edge.p.x + CARD_W / 2}
					{@const y1 = edge.p.y + CARD_H}
					{@const x2 = edge.c.x + CARD_W / 2}
					{@const y2 = edge.c.y}
					{@const midY = (y1 + y2) / 2}
					<path
						d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
						fill="none"
						stroke="var(--color-border, #2a2a2a)"
						stroke-width="1.5"
					/>
				{/each}
			</g>
		</svg>

		<!-- Cards -->
		<div
			class="absolute inset-0"
			style="transform: translate({pan.x}px, {pan.y}px) scale({zoom}); transform-origin: 0 0;"
		>
			{#each allNodes as node (node.id)}
				{@const a = agentMap.get(node.id)}
				<a
					href="/workforce/agents/{node.id}"
					class="absolute bg-card border border-border rounded-lg shadow-sm hover:shadow-md hover:border-foreground/30 transition-[box-shadow,border-color] duration-150 select-none flex"
					style="left: {node.x}px; top: {node.y}px; width: {CARD_W}px; min-height: {CARD_H}px;"
				>
					<div class="flex items-center px-4 py-3 gap-3 w-full">
						<div class="relative shrink-0">
							<div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-foreground/70">
								{node.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
							</div>
							<span
								class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
								style="background:{dotColor(node.status)}"
								title={node.status}
							></span>
						</div>
						<div class="flex flex-col items-start min-w-0 flex-1">
							<span class="text-sm font-semibold text-foreground leading-tight truncate w-full">
								{node.name}
							</span>
							<span class="text-[11px] text-muted-foreground leading-tight mt-0.5">
								{a?.title ?? roleLabel(node.role)}
							</span>
							{#if a?.adapterType}
								<span class="text-[10px] text-muted-strong font-mono leading-tight mt-1">
									{a.adapterType}
								</span>
							{/if}
						</div>
					</div>
				</a>
			{/each}
		</div>
	</div>

	<!-- Status legend -->
	<footer class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
		{#each Object.entries(STATUS_DOT) as [status, color] (status)}
			<span class="inline-flex items-center gap-1.5">
				<span class="h-2 w-2 rounded-full" style="background:{color}"></span>
				{statusLabel(status)}
			</span>
		{/each}
	</footer>
</main>
