<script lang="ts">
	import { onDestroy } from 'svelte';
	import { X } from 'lucide-svelte';
	import { createAsyncDebouncer } from '$lib/pacer/index.svelte';

	type Party = { id: string; name: string | null; type: string; email: string | null; docNumber: string | null };

	let {
		value = $bindable(null),
		label = '',
		placeholder = 'Search parties…',
		types = undefined,
		initialName = '',
	}: {
		value?: string | null;
		label?: string;
		placeholder?: string;
		/** Comma-separated party types to filter, e.g. "person,company". */
		types?: string | undefined;
		initialName?: string;
	} = $props();

	// svelte-ignore state_referenced_locally -- seed the editable query once from the prop
	let q = $state(initialName);
	let results = $state<Party[]>([]);
	let open = $state(false);

	// A slow response for an earlier keystroke can otherwise land after a
	// faster response for a later one and overwrite it with stale results.
	// AsyncDebouncer only collapses calls still *pending* — it does not
	// guarantee a superseding call wins once two fetches are in flight — so
	// guard the commit with a seq token (same pattern as
	// `runRecordSearch` in $lib/state/ui/command-palette.svelte.ts).
	let searchSeq = 0;
	const search = createAsyncDebouncer(
		async (term: string) => {
			const seq = ++searchSeq;
			const u = new URL('/api/crm/parties', location.origin);
			u.searchParams.set('q', term);
			if (types) u.searchParams.set('type', types);
			const r = await fetch(u);
			if (seq !== searchSeq) return; // a newer search superseded this one
			if (r.ok) {
				results = await r.json();
				open = true;
			}
		},
		{ wait: 200 },
	);
	onDestroy(() => search.cancel());

	function onInput(e: Event) {
		q = (e.currentTarget as HTMLInputElement).value;
		value = null; // typing invalidates the prior selection until re-picked
		search.run(q);
	}

	function pick(p: Party) {
		value = p.id;
		q = p.name ?? p.email ?? p.id;
		open = false;
	}

	function clear() {
		value = null;
		q = '';
		results = [];
		open = false;
	}
</script>

<div class="pp">
	{#if label}<span class="lbl">{label}</span>{/if}
	<div class="field">
		<input
			class="in"
			{placeholder}
			value={q}
			oninput={onInput}
			onfocus={() => q && search.run(q)}
			onblur={() => setTimeout(() => (open = false), 150)}
		/>
		{#if value || q}
			<button class="clr" type="button" title="Clear" onclick={clear}><X size={13} /></button>
		{/if}
		{#if open && results.length}
			<ul class="menu">
				{#each results as p (p.id)}
					<li>
						<button type="button" onclick={() => pick(p)}>
							<span class="nm">{p.name ?? '(unnamed)'}</span>
							<span class="ty">{p.type}{p.email ? ` · ${p.email}` : p.docNumber ? ` · ${p.docNumber}` : ''}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.pp { display: flex; flex-direction: column; gap: 0.2rem; flex: 1; min-width: 0; }
	.lbl { font-size: 0.72rem; color: var(--color-muted-foreground); }
	.field { position: relative; }
	.in { width: 100%; height: 2rem; font-size: 0.86rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); padding: 0 1.8rem 0 0.55rem; color: var(--color-foreground); }
	.clr { position: absolute; right: 0.3rem; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--color-muted-foreground); cursor: pointer; display: grid; place-items: center; }
	.menu { position: absolute; z-index: 20; top: calc(100% + 2px); left: 0; right: 0; max-height: 14rem; overflow: auto; margin: 0; padding: 0.25rem; list-style: none; background: var(--color-card); border: 1px solid var(--hairline); border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.18); }
	.menu li button { width: 100%; text-align: left; background: none; border: none; padding: 0.4rem 0.5rem; border-radius: var(--radius-sm, 4px); cursor: pointer; display: flex; flex-direction: column; gap: 0.05rem; color: var(--color-foreground); }
	.menu li button:hover { background: var(--color-bg3); }
	.nm { font-size: 0.84rem; }
	.ty { font-size: 0.72rem; color: var(--color-muted-foreground); }
</style>
