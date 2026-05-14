<script lang="ts">
	import Self from './JsonView.svelte';

	interface Props {
		value: unknown;
		/** Hide the wrapping braces / brackets at the top level (used inline) */
		compact?: boolean;
		/** Indentation depth, used internally for recursion */
		depth?: number;
	}

	const { value, compact = false, depth = 0 }: Props = $props();

	function humanizeKey(key: string): string {
		return key
			.replace(/[_-]+/g, ' ')
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			.replace(/^./, (c) => c.toUpperCase());
	}

	function isPlainObject(v: unknown): v is Record<string, unknown> {
		return typeof v === 'object' && v !== null && !Array.isArray(v);
	}

	function isPrimitive(v: unknown): boolean {
		return v === null || ['string', 'number', 'boolean'].includes(typeof v);
	}

	function shortId(s: string): string {
		// UUID-ish: show first 8 chars only
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)) return s.slice(0, 8) + '…';
		return s;
	}

	function formatPrimitive(v: unknown): { text: string; mono: boolean; muted: boolean } {
		if (v === null) return { text: '—', mono: false, muted: true };
		if (v === undefined) return { text: '—', mono: false, muted: true };
		if (typeof v === 'boolean') return { text: v ? 'true' : 'false', mono: true, muted: false };
		if (typeof v === 'number') return { text: String(v), mono: true, muted: false };
		const s = String(v);
		if (s === '***REDACTED***') return { text: 'redacted', mono: false, muted: true };
		// Heuristics: ids / hex / urls render as mono
		const mono =
			/^[0-9a-f-]{12,}$/i.test(s) ||
			/^https?:\/\//.test(s) ||
			/^[a-z0-9._-]+\.[a-z0-9._-]+/i.test(s) && !/\s/.test(s);
		return { text: mono && s.length > 16 ? shortId(s) : s, mono, muted: false };
	}

	const entries = $derived.by(() => {
		if (isPlainObject(value)) return Object.entries(value);
		return [] as [string, unknown][];
	});
</script>

{#if isPrimitive(value)}
	{@const f = formatPrimitive(value)}
	<span class={f.mono ? 'font-mono text-xs' : ''} class:text-muted-foreground={f.muted}>{f.text}</span>
{:else if Array.isArray(value)}
	{#if value.length === 0}
		<span class="text-xs text-muted-foreground">[]</span>
	{:else if value.every(isPrimitive)}
		<span class="flex flex-wrap gap-1">
			{#each value as item}
				{@const f = formatPrimitive(item)}
				<span class="rounded bg-muted px-1.5 py-0.5 text-xs {f.mono ? 'font-mono' : ''}">{f.text}</span>
			{/each}
		</span>
	{:else}
		<ul class="space-y-1 {depth > 0 ? 'ml-3 border-l border-border/40 pl-3' : ''}">
			{#each value as item, i}
				<li>
					<span class="text-xs text-muted-foreground mr-2">[{i}]</span>
					<Self value={item} depth={depth + 1} compact />
				</li>
			{/each}
		</ul>
	{/if}
{:else if isPlainObject(value)}
	{#if entries.length === 0}
		<span class="text-xs text-muted-foreground">—</span>
	{:else}
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs {depth > 0 ? 'mt-1 ml-3 border-l border-border/40 pl-3' : ''}">
			{#each entries as [key, val] (key)}
				<dt class="text-muted-foreground whitespace-nowrap">{humanizeKey(key)}</dt>
				<dd class="min-w-0 break-words text-foreground/90">
					<Self value={val} depth={depth + 1} compact />
				</dd>
			{/each}
		</dl>
	{/if}
{:else}
	<span class="text-xs text-muted-foreground">—</span>
{/if}
