<script lang="ts">
	// Cross-module nav landing banner: when a list is scoped to one contact via
	// ?contact= (from the Connections panel count→list jump), tell the user it's
	// filtered and give a one-click Clear. ERPNext's route_options round-trip; the
	// "feels like one system" finish for §2c. Renders nothing when not scoped.
	import { page } from '$app/state';
	import { X } from 'lucide-svelte';

	let { name, contactId = null, noun = 'records' }: { name: string | null; contactId?: string | null; noun?: string } = $props();

	// Clear = same path, minus the cross-nav params.
	const clearHref = $derived.by(() => {
		const qs = new URLSearchParams(page.url.search);
		qs.delete('contact');
		qs.delete('new');
		const s = qs.toString();
		return s ? `${page.url.pathname}?${s}` : page.url.pathname;
	});
</script>

{#if name}
	<div class="scope">
		<span class="lbl">Showing {noun} for</span>
		{#if contactId}
			<a class="who" href={`/crm/${contactId}`}>{name}</a>
		{:else}
			<span class="who">{name}</span>
		{/if}
		<a class="clear" href={clearHref} title="Clear filter"><X size={12} /> Clear</a>
	</div>
{/if}

<style>
	.scope {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		font-size: 0.8rem;
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		color: var(--color-foreground);
	}
	.lbl {
		color: var(--color-muted-foreground);
	}
	.who {
		font-weight: 600;
		color: var(--color-accent);
	}
	a.who:hover {
		text-decoration: underline;
	}
	.clear {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		margin-left: 0.25rem;
		padding-left: 0.45rem;
		border-left: 1px solid var(--hairline);
		color: var(--color-muted-foreground);
	}
	.clear:hover {
		color: var(--color-foreground);
	}
</style>
