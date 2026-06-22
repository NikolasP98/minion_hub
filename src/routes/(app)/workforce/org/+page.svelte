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
		type Node,
		type Edge,
		type NodeTypes,
		type ColorMode,
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import OrgChartNode from '$lib/components/workforce/OrgChartNode.svelte';
	import { theme } from '$lib/state/ui/theme.svelte';

	type OrgNode = { id: string; name: string; role: string; status: string; reports: OrgNode[] };

	let { data }: { data: PageData } = $props();
	const { tree, agents } = $derived(data);

	const CARD_W = 220;
	const CARD_H = 96;
	const GAP_X = 36;
	const GAP_Y = 72;

	// Tidy top-down tree layout — give each subtree its own horizontal band so
	// siblings never overlap, then center parents over their children. SvelteFlow
	// owns pan/zoom/fit; we only supply absolute node positions.
	function subtreeWidth(node: OrgNode): number {
		if (node.reports.length === 0) return CARD_W;
		const childrenW = node.reports.reduce((s, c) => s + subtreeWidth(c), 0);
		return Math.max(CARD_W, childrenW + (node.reports.length - 1) * GAP_X);
	}

	const agentMap = $derived(new Map(agents.map((a) => [a.id, a])));

	function buildGraph(roots: OrgNode[]): { nodes: Node[]; edges: Edge[] } {
		const nodes: Node[] = [];
		const edges: Edge[] = [];

		function place(node: OrgNode, x: number, y: number, isRoot: boolean) {
			const totalW = subtreeWidth(node);
			const a = agentMap.get(node.id);
			nodes.push({
				id: node.id,
				type: 'org',
				position: { x: x + (totalW - CARD_W) / 2, y },
				data: {
					name: node.name,
					role: node.role,
					status: node.status,
					title: a?.title ?? null,
					adapterType: a?.adapterType ?? null,
					isRoot,
				},
				draggable: false,
			});
			if (node.reports.length > 0) {
				const childrenW = node.reports.reduce((s, c) => s + subtreeWidth(c), 0);
				const gaps = (node.reports.length - 1) * GAP_X;
				let cx = x + (totalW - childrenW - gaps) / 2;
				for (const child of node.reports) {
					const cw = subtreeWidth(child);
					edges.push({
						id: `${node.id}-${child.id}`,
						source: node.id,
						target: child.id,
						type: 'smoothstep',
					});
					place(child, cx, y + CARD_H + GAP_Y, false);
					cx += cw + GAP_X;
				}
			}
		}

		let x = 0;
		for (const root of roots) {
			place(root, x, 0, true);
			x += subtreeWidth(root) + GAP_X;
		}
		return { nodes, edges };
	}

	const nodeTypes: NodeTypes = { org: OrgChartNode };
	const colorMode: ColorMode = $derived(theme.preset.id === 'light' ? 'light' : 'dark');

	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);

	// Rebuild on data change (8s poll). Node ids are stable, so SvelteFlow
	// reconciles by id and keeps the viewport across status updates.
	$effect(() => {
		const g = buildGraph(tree);
		nodes = g.nodes;
		edges = g.edges;
	});

	onMount(() => startPolling('app:org', 8000));

	const STATUS_DOT: Record<string, string> = {
		active: '#10b981',
		running: '#3b82f6',
		paused: '#f59e0b',
		error: '#ef4444',
		idle: '#6b7280',
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

<!--
	Explicit viewport height: the workforce layout's content <main> is
	overflow-y-auto (not a flex column), so flex-1 here collapses to 0 and
	SvelteFlow — which fills its parent's height — renders nothing. Pin the page
	to viewport-minus-topbar (3.5rem) and flex inside it, per the layout contract.
-->
<div class="flex h-[calc(100vh-3.5rem)] flex-col">
<PageHeader title={m.workforce_orgChart()}>
	{#snippet leading()}
		<Network size={16} class="text-accent shrink-0" />
	{/snippet}
	{#snippet actions()}
		<LiveIndicator intervalMs={8000} />
		<div class="text-muted-foreground hidden text-xs md:block">
			{m.workforce_orgChartInfo({ count: nodes.length })}
		</div>
	{/snippet}
</PageHeader>

<main class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-6">
	<div class="border-border bg-muted/20 relative min-h-0 flex-1 overflow-hidden rounded-lg border">
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
				fitViewOptions={{ padding: 0.15, minZoom: 0.2 }}
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
			</SvelteFlow>
		{/if}
	</div>

	<footer class="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
		{#each Object.entries(STATUS_DOT) as [status, color] (status)}
			<span class="inline-flex items-center gap-1.5">
				<span class="h-2 w-2 rounded-full" style="background:{color}"></span>
				{statusLabel(status)}
			</span>
		{/each}
	</footer>
</main>
</div>
