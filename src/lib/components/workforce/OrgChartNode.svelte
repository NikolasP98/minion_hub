<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	export type OrgNodeData = {
		name: string;
		role: string;
		status: string;
		title?: string | null;
		adapterType?: string | null;
		isRoot?: boolean;
	};

	let { data }: NodeProps & { data: OrgNodeData } = $props();

	const STATUS_DOT: Record<string, string> = {
		active: '#10b981',
		running: '#3b82f6',
		paused: '#f59e0b',
		error: '#ef4444',
		idle: '#6b7280',
	};
	const dot = $derived(STATUS_DOT[data.status] ?? '#6b7280');
	const initials = $derived(
		data.name
			.split(' ')
			.map((w) => w[0])
			.slice(0, 2)
			.join(''),
	);
	const roleLabel = $derived(data.role.charAt(0).toUpperCase() + data.role.slice(1).replaceAll('_', ' '));
</script>

<!-- Top inbound handle for everyone but a root -->
{#if !data.isRoot}
	<Handle type="target" position={Position.Top} class="!h-2 !w-2 !border-2 !border-border !bg-muted" />
{/if}

<div
	class="bg-card border-border hover:border-foreground/30 flex min-h-[88px] w-[220px] select-none rounded-lg border shadow-sm transition-[box-shadow,border-color] duration-150 hover:shadow-md"
>
	<div class="flex w-full items-center gap-3 px-4 py-3">
		<div class="relative shrink-0">
			<div
				class="bg-muted text-foreground/70 flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
			>
				{initials}
			</div>
			<span
				class="border-card absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2"
				style="background:{dot}"
				title={data.status}
			></span>
		</div>
		<div class="flex min-w-0 flex-1 flex-col items-start">
			<span class="text-foreground w-full truncate text-sm font-semibold leading-tight">
				{data.name}
			</span>
			<span class="text-muted-foreground mt-0.5 text-[11px] leading-tight">
				{data.title ?? roleLabel}
			</span>
			{#if data.adapterType}
				<span class="text-muted-strong mt-1 font-mono text-[10px] leading-tight">
					{data.adapterType}
				</span>
			{/if}
		</div>
	</div>
</div>

<!-- Bottom outbound handle (managers connect down to reports) -->
<Handle type="source" position={Position.Bottom} class="!h-2 !w-2 !border-2 !border-border !bg-muted" />
