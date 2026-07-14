<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import { PageHeader } from '$lib/components/ui';
	import { Network } from 'lucide-svelte';
	import {
		SvelteFlow,
		Background,
		Controls,
		Position,
		type Node,
		type Edge,
		type NodeTypes,
		type ColorMode,
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import OrgChartNode from '$lib/components/workforce/OrgChartNode.svelte';
	import OrgFitController from '$lib/components/workforce/OrgFitController.svelte';
	import { theme } from '$lib/state/ui/theme.svelte';
	import { diceBearAvatarUrl } from '$lib/utils/avatar';

	type OrgNode = { id: string; name: string; role: string; status: string; reports: OrgNode[] };
	type Orientation = 'vertical' | 'horizontal';

	let { data }: { data: PageData } = $props();
	const { tree, agents } = $derived(data);

	const CARD_W = 220;
	const CARD_H = 96;
	const GAP_X = 36;
	const GAP_Y = 72;

	// Responsive orientation: wide viewports get a top→bottom tree, tall/narrow
	// ones get a left→right tree (better use of the dominant axis).
	let containerEl = $state<HTMLDivElement>();
	let orientation = $state<Orientation>('vertical');

	const agentMap = $derived(new Map(agents.map((a) => [a.id, a])));

	// One generic tidy-tree layout parameterised by orientation. "main" axis =
	// depth (root→leaves), "cross" axis = sibling spread.
	function buildGraph(roots: OrgNode[], dir: Orientation): { nodes: Node[]; edges: Edge[] } {
		const vertical = dir === 'vertical';
		const CROSS = vertical ? CARD_W : CARD_H;
		const CROSS_GAP = vertical ? GAP_X : GAP_Y;
		const MAIN_STEP = vertical ? CARD_H + GAP_Y : CARD_W + GAP_X;

		const nodes: Node[] = [];
		const edges: Edge[] = [];

		function extent(node: OrgNode): number {
			if (node.reports.length === 0) return CROSS;
			const c =
				node.reports.reduce((s, ch) => s + extent(ch), 0) + (node.reports.length - 1) * CROSS_GAP;
			return Math.max(CROSS, c);
		}

		function place(node: OrgNode, crossStart: number, depth: number, isRoot: boolean) {
			const ext = extent(node);
			const cross = crossStart + (ext - CROSS) / 2;
			const main = depth * MAIN_STEP;
			const a = agentMap.get(node.id);
			nodes.push({
				id: node.id,
				type: 'org',
				position: vertical ? { x: cross, y: main } : { x: main, y: cross },
				sourcePosition: vertical ? Position.Bottom : Position.Right,
				targetPosition: vertical ? Position.Top : Position.Left,
				draggable: false,
				data: {
					name: node.name,
					role: node.role,
					status: node.status,
					title: a?.title ?? null,
					adapterType: a?.adapterType ?? null,
					isRoot,
					orientation: dir,
					avatarUrl: diceBearAvatarUrl(node.id, 'autonomous'),
				},
			});
			if (node.reports.length > 0) {
				const childrenExt = node.reports.reduce((s, ch) => s + extent(ch), 0);
				const gaps = (node.reports.length - 1) * CROSS_GAP;
				let cs = crossStart + (ext - childrenExt - gaps) / 2;
				for (const child of node.reports) {
					edges.push({
						id: `${node.id}-${child.id}`,
						source: node.id,
						target: child.id,
						type: 'smoothstep',
					});
					place(child, cs, depth + 1, false);
					cs += extent(child) + CROSS_GAP;
				}
			}
		}

		let cursor = 0;
		for (const root of roots) {
			place(root, cursor, 0, true);
			cursor += extent(root) + CROSS_GAP;
		}
		return { nodes, edges };
	}

	const nodeTypes: NodeTypes = { org: OrgChartNode };
	const colorMode: ColorMode = $derived(theme.mode);

	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);

	// Rebuild on data (8s poll) or orientation change. Stable node ids let
	// SvelteFlow reconcile in place; the CSS transition animates the move.
	$effect(() => {
		const g = buildGraph(tree, orientation);
		nodes = g.nodes;
		edges = g.edges;
	});

	onMount(() => {
		const stopPoll = startPolling('app:org', 8000);
		let ro: ResizeObserver | undefined;
		if (containerEl) {
			ro = new ResizeObserver((entries) => {
				const r = entries[0]?.contentRect;
				if (r) orientation = r.width >= r.height ? 'vertical' : 'horizontal';
			});
			ro.observe(containerEl);
		}
		return () => {
			stopPoll();
			ro?.disconnect();
		};
	});

	const STATUS_DOT: Record<string, string> = {
		active: 'var(--color-emerald)',
		running: 'var(--color-accent)',
		paused: 'var(--color-warning-fg)',
		error: 'var(--color-danger-fg)',
		idle: 'var(--color-text-tertiary)',
	};
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
</script>

<div class="flex h-[calc(100vh-3.5rem)] flex-col">
	<PageHeader title={m.workforce_orgChart()}>
		{#snippet leading()}
			<Network size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>

	<!-- Toolbar: live status + instructions + legend, above the canvas (not the header). -->
	<div
		class="border-border flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-4 py-2 text-xs"
	>
		<LiveIndicator intervalMs={8000} />
		<span class="text-muted-foreground">
			{m.workforce_orgChartInfo({ count: nodes.length })}
		</span>
		<div class="text-muted-foreground ml-auto flex flex-wrap items-center gap-3">
			{#each Object.entries(STATUS_DOT) as [status, color] (status)}
				<span class="inline-flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full" style="background:{color}"></span>
					{statusLabel(status)}
				</span>
			{/each}
		</div>
	</div>

	<!-- Maximized canvas: fills all remaining space, no padding. -->
	<div bind:this={containerEl} class="bg-muted/10 relative min-h-0 flex-1">
		{#if nodes.length === 0}
			<div class="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
				{m.workforce_orgChartInfo({ count: 0 })}
			</div>
		{:else}
			<SvelteFlow
				bind:nodes
				bind:edges
				{nodeTypes}
				{colorMode}
				fitView
				fitViewOptions={{ ['padding']: 0.15, minZoom: 0.2 }}
				minZoom={0.2}
				maxZoom={2}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				panOnDrag
				zoomOnScroll
				proOptions={{ hideAttribution: true }}
			>
				<Background />
				<Controls showLock={false} />
				<OrgFitController trigger={orientation} />
			</SvelteFlow>
		{/if}
	</div>
</div>

<style>
	/* Graceful animation when nodes reposition (e.g. orientation flip). */
	:global(.svelte-flow__node) {
		transition: transform var(--duration-slow) var(--ease-standard),
			box-shadow var(--duration-fast) var(--ease-standard),
			border-color var(--duration-fast) var(--ease-standard);
	}
</style>
