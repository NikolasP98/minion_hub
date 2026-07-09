<script lang="ts">
	import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
	import { Brain, Wrench, Loader, Check, TriangleAlert } from 'lucide-svelte';
	import { normalizeBlocks, type ChatBlock, type ToolResult } from './blocks';

	interface Props {
		/** Message-shaped object whose `content` carries the block array. */
		message: { content?: unknown };
		/** tool_use_id → result, collected across the whole thread by the parent. */
		toolResults?: Record<string, ToolResult>;
		/** True while this turn is still streaming (affects tool/"thinking" labels). */
		streaming?: boolean;
		/**
		 * When set, render THIS text as the answer instead of the message's own
		 * text blocks — used during streaming to show the smoothed (typewriter)
		 * reveal while reasoning/tool meta still come from `message`, or by
		 * consumers (ChatMessage.svelte) that apply their own text cleanup
		 * pipeline before display.
		 */
		textOverride?: string;
		/** Tones down chrome for small surfaces (floating assistant, drawers). */
		compact?: boolean;
	}

	const {
		message,
		toolResults = {},
		streaming = false,
		textOverride,
		compact = false
	}: Props = $props();

	const blocks = $derived(normalizeBlocks(message.content));

	// Reasoning + tool activity render OUTSIDE the answer bubble (so a sequence of
	// tool calls reads as a quiet list above the reply); text/images are the reply.
	const bodyBlocks = $derived(blocks.filter((b) => b.kind === 'text' || b.kind === 'image'));

	// Consecutive tool calls collapse into ONE "N tool uses" row (level 1) that
	// expands to the per-tool rows (level 2), each expanding to input/output
	// (level 3). Reasoning is not a tool — it breaks the grouping.
	type ToolBlock = Extract<ChatBlock, { kind: 'tool' }>;
	type MetaGroup =
		| { kind: 'thinking'; text: string }
		| { kind: 'tools'; tools: ToolBlock[] };
	const metaGroups = $derived.by<MetaGroup[]>(() => {
		const groups: MetaGroup[] = [];
		for (const b of blocks) {
			if (b.kind === 'thinking') {
				groups.push({ kind: 'thinking', text: b.text });
			} else if (b.kind === 'tool') {
				const last = groups.at(-1);
				if (last?.kind === 'tools') last.tools.push(b);
				else groups.push({ kind: 'tools', tools: [b] });
			}
		}
		return groups;
	});

	function groupStatus(tools: ToolBlock[]): 'pending' | 'err' | 'ok' {
		let ok = true;
		for (const t of tools) {
			const r = t.id ? toolResults[t.id] : undefined;
			if (streaming && !r) return 'pending';
			if (r?.isError) ok = false;
		}
		return ok ? 'ok' : 'err';
	}

	function fmtInput(input: unknown): string {
		if (input === undefined || input === null) return '';
		if (typeof input === 'string') return input;
		try {
			return JSON.stringify(input, null, 2);
		} catch {
			return String(input);
		}
	}
	function preview(input: unknown): string {
		const s = typeof input === 'string' ? input : fmtInput(input).replace(/\s+/g, ' ');
		return s.length > 56 ? s.slice(0, 56) + '…' : s;
	}
</script>

{#snippet toolRow(block: ToolBlock)}
	{@const result = block.id ? toolResults[block.id] : undefined}
	{@const pending = streaming && !result}
	<details class="meta">
		<summary>
			<Wrench size={12} class="mi" />
			<span class="label tool-name">{block.name}</span>
			{#if preview(block.input)}<span class="tool-arg">{preview(block.input)}</span>{/if}
			<span class="tool-status" class:err={result?.isError}>
				{#if pending}
					<Loader size={11} class="spin" />
				{:else if result?.isError}
					<TriangleAlert size={11} />
				{:else if result}
					<Check size={11} />
				{/if}
			</span>
		</summary>
		<div class="meta-body">
			{#if fmtInput(block.input)}
				<div class="sect">Input</div>
				<pre class="pre">{fmtInput(block.input)}</pre>
			{/if}
			{#if result}
				<div class="sect">{result.isError ? 'Error' : 'Result'}</div>
				<pre class="pre" class:err={result.isError}>{result.content}</pre>
			{:else if pending}
				<div class="pending">Running…</div>
			{/if}
		</div>
	</details>
{/snippet}

<div class="turn" class:compact>
	{#each metaGroups as group, i (i)}
		{#if group.kind === 'thinking'}
			<details class="meta">
				<summary>
					<Brain size={12} class="mi" />
					<span class="label">{streaming ? 'Thinking…' : 'Reasoning'}</span>
				</summary>
				<div class="meta-body reason">{group.text}</div>
			</details>
		{:else if group.tools.length === 1}
			{@render toolRow(group.tools[0])}
		{:else}
			{@const status = groupStatus(group.tools)}
			<details class="meta">
				<summary>
					<Wrench size={12} class="mi" />
					<span class="label">{group.tools.length} tool uses</span>
					<span class="tool-arg">{[...new Set(group.tools.map((t) => t.name))].join(' · ')}</span>
					<span class="tool-status" class:err={status === 'err'}>
						{#if status === 'pending'}
							<Loader size={11} class="spin" />
						{:else if status === 'err'}
							<TriangleAlert size={11} />
						{:else}
							<Check size={11} />
						{/if}
					</span>
				</summary>
				<div class="group-body">
					{#each group.tools as block, j (j)}
						{@render toolRow(block)}
					{/each}
				</div>
			</details>
		{/if}
	{/each}

	{#if textOverride !== undefined}
		{#if textOverride.length > 0}
			<div class="answer" class:streaming class:compact>
				<MarkdownMessage value={textOverride} tone="assistant" />
			</div>
		{/if}
	{:else if bodyBlocks.length > 0}
		<div class="answer" class:streaming class:compact>
			{#each bodyBlocks as block, i (i)}
				{#if block.kind === 'text'}
					<MarkdownMessage value={block.text} tone="assistant" />
				{:else if block.kind === 'image'}
					<div class="img-chip">🖼 Image</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.turn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		width: 100%;
		min-width: 0;
	}

	/* ── Reasoning + tool rows: deliberately quiet, no card chrome ── */
	details.meta {
		border: none;
		background: none;
		max-width: 100%;
		min-width: 0;
	}
	summary {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 7px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 11.5px;
		color: color-mix(in srgb, var(--color-foreground) 32%, transparent);
		list-style: none;
		user-select: none;
		transition: color 160ms ease;
		min-width: 0;
	}
	.turn.compact summary {
		padding: 1px 5px;
		font-size: 10.5px;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:hover {
		color: color-mix(in srgb, var(--color-foreground) 72%, transparent);
	}
	/* Subtle "shine" sweep on hover. */
	summary::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(
			100deg,
			transparent 30%,
			color-mix(in srgb, var(--color-foreground) 7%, transparent) 50%,
			transparent 70%
		);
		transform: translateX(-120%);
	}
	summary:hover::after {
		animation: meta-shine 0.9s ease;
	}
	@keyframes meta-shine {
		to {
			transform: translateX(120%);
		}
	}
	summary :global(.mi) {
		flex-shrink: 0;
		opacity: 0.6;
	}
	.label {
		flex-shrink: 0;
	}
	.tool-name {
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}
	.turn.compact .tool-name {
		font-size: 10px;
	}
	.tool-arg {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.7;
	}
	.tool-status {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		margin-left: 4px;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
	}
	.tool-status.err {
		color: var(--color-accent);
	}
	.tool-status :global(.spin) {
		animation: ct-spin 0.8s linear infinite;
	}
	@keyframes ct-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Level-2 list inside a collapsed "N tool uses" group. */
	.group-body {
		padding: 1px 0 4px 16px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.meta-body {
		padding: 2px 9px 8px 24px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.turn.compact .meta-body {
		padding: 2px 7px 6px 20px;
	}
	.meta-body.reason {
		font-size: 12px;
		line-height: 1.55;
		color: color-mix(in srgb, var(--color-foreground) 50%, transparent);
		white-space: pre-wrap;
		font-style: italic;
	}
	.turn.compact .meta-body.reason {
		font-size: 11px;
	}
	.sect {
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
		margin-top: 2px;
	}
	.pre {
		margin: 0;
		padding: 6px 8px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.28);
		font-size: 11px;
		line-height: 1.45;
		font-family: ui-monospace, monospace;
		color: color-mix(in srgb, var(--color-foreground) 72%, transparent);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 220px;
		overflow: auto;
		scrollbar-width: thin;
	}
	.pre.err {
		color: var(--color-accent);
	}
	.pending {
		font-size: 11px;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
		font-style: italic;
	}

	/* ── The answer bubble (text only) ── */
	.answer {
		max-width: 85%;
		border-radius: 12px;
		padding: 8px 12px;
		font-size: 13px;
		line-height: 1.5;
		color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
		background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
		word-break: break-word;
	}
	.answer.compact {
		max-width: 100%;
		padding: 6px 9px;
		font-size: 12px;
	}
	.answer.streaming {
		border-style: dashed;
		opacity: 0.92;
	}

	.img-chip {
		display: inline-block;
		font-size: 12px;
		color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
		padding: 4px 8px;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
		border-radius: 7px;
	}
</style>
