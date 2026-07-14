<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Button, Select } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();

	const DOC_LABEL: Record<string, string> = { support_issue: 'Support ticket', sales_order: 'Sales order' };

	// New/edit form. One def per doc_type (upsert), so editing = loading its JSON.
	let docType = $state('support_issue');
	let name = $state('Default');
	let enabled = $state(true);
	let statesText = $state('open, replied, on_hold, resolved, closed');
	// transitions JSON: [{action,from,to,role?,allowSelfApprove?}]
	let transitionsText = $state(
		JSON.stringify(
			[
				{ action: 'Reply', from: 'open', to: 'replied' },
				{ action: 'Resolve', from: 'replied', to: 'resolved', role: 'admin' },
			],
			null,
			2,
		),
	);
	let err = $state('');
	let busy = $state(false);

	function loadDef(d: (typeof data.defs)[number]) {
		docType = d.docType;
		name = d.name;
		enabled = d.enabled;
		statesText = (d.states as string[]).join(', ');
		transitionsText = JSON.stringify(d.transitions, null, 2);
		err = '';
	}

	async function save() {
		err = '';
		let transitions: unknown;
		try {
			transitions = JSON.parse(transitionsText);
			if (!Array.isArray(transitions)) throw new Error('transitions must be an array');
		} catch (e) {
			err = `Invalid transitions JSON: ${e instanceof Error ? e.message : e}`;
			return;
		}
		const states = statesText.split(',').map((s) => s.trim()).filter(Boolean);
		busy = true;
		try {
			const res = await fetch('/api/workflow/defs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ docType, name, enabled, states, transitions }),
			});
			if (res.ok) await invalidate('settings:workflows');
			else err = (await res.json().catch(() => ({}))).message ?? `Save failed (${res.status})`;
		} finally {
			busy = false;
		}
	}

	async function remove(id: string) {
		await fetch(`/api/workflow/defs/${id}`, { method: 'DELETE' });
		await invalidate('settings:workflows');
	}
</script>

<PageHeader title="Workflows" subtitle="Role-gated state machines for tickets and orders" />

<div class="wrap">
	<div class="card">
		<h3>Edit workflow</h3>
		<div class="grid">
			<label>Doc type
				<Select size="sm" bind:value={docType}>
					{#each data.docTypes as dt (dt)}<option value={dt}>{DOC_LABEL[dt] ?? dt}</option>{/each}
				</Select>
			</label>
			<label>Name<input class="inp" bind:value={name} /></label>
		</div>
		<label class="block">States (comma-separated)<input class="inp" bind:value={statesText} /></label>
		<label class="block">Transitions (JSON)
			<textarea class="inp ta" rows="10" bind:value={transitionsText}></textarea>
		</label>
		<label class="row"><input type="checkbox" bind:checked={enabled} /> Enabled</label>
		{#if err}<p class="err">{err}</p>{/if}
		<Button onclick={save} disabled={busy || !name.trim()}>Save workflow</Button>
		<p class="hint">Transition fields: <code>action</code>, <code>from</code>, <code>to</code>, optional <code>role</code> (e.g. "admin"), optional <code>allowSelfApprove</code> (false = the assignee can't take it).</p>
	</div>

	{#each data.defs as d (d.id)}
		<div class="card def">
			<div class="def-head">
				<strong>{DOC_LABEL[d.docType] ?? d.docType}</strong> · {d.name}
				{#if !d.enabled}<span class="muted">(disabled)</span>{/if}
				<div class="spacer"></div>
				<Button size="sm" variant="ghost" onclick={() => loadDef(d)}>Edit</Button>
				<Button size="sm" variant="ghost" onclick={() => remove(d.id)}>Delete</Button>
			</div>
			<div class="muted small">{(d.states as string[]).join(' → ')} · {(d.transitions as unknown[]).length} transitions</div>
		</div>
	{/each}
</div>

<style>
	.wrap { display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem var(--space-page-gutter, 16px); max-width: calc(720px + var(--space-page-gutter, 16px) + var(--space-page-gutter, 16px)); }
	.card { padding: 0.9rem 1rem; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--color-bg2); }
	.card h3 { margin: 0 0 0.6rem; font-size: 0.95rem; }
	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-bottom: 0.6rem; }
	label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.82rem; opacity: 0.9; }
	.block { margin-bottom: 0.6rem; }
	.row { flex-direction: row; align-items: center; gap: 0.4rem; margin-bottom: 0.7rem; }
	.inp { padding: 0.4rem 0.55rem; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--color-bg3); color: inherit; font-size: 0.86rem; }
	.ta { font-family: var(--font-mono, monospace); font-size: 0.8rem; }
	.def-head { display: flex; align-items: center; gap: 0.4rem; }
	.spacer { flex: 1; }
	.muted { opacity: 0.7; }
	.small { font-size: 0.8rem; margin-top: 0.3rem; }
	.err { color: var(--color-danger, #ef4444); font-size: 0.82rem; }
	.hint { font-size: 0.78rem; opacity: 0.65; margin: 0.5rem 0 0; }
	@media (max-width: 767.98px) {
		.grid { grid-template-columns: minmax(0, 1fr); }
		.def-head { align-items: stretch; flex-wrap: wrap; }
		.def-head .spacer { display: none; }
		.def-head strong { width: 100%; }
	}
</style>
