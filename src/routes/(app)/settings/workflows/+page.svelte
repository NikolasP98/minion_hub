<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Button, Select } from '$lib/components/ui';
	import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();

	const DOC_LABEL: Record<string, string> = { support_issue: m.wf_doc_supportIssue(), sales_order: m.wf_doc_salesOrder() };

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
			err = m.wf_errInvalidTransitions({ message: e instanceof Error ? e.message : String(e) });
			return;
		}
		const states = statesText.split(',').map((s) => s.trim()).filter(Boolean);
		busy = true;
		try {
			await jsonMutation({
				input: '/api/workflow/defs',
				init: {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ docType, name, enabled, states, transitions }),
				},
				onSuccess: () => invalidate('settings:workflows'),
			});
		} catch (error) {
			err = mutationErrorMessage(error, m.common_error());
		} finally {
			busy = false;
		}
	}

	async function remove(id: string) {
		err = '';
		try {
			await jsonMutation({
				input: `/api/workflow/defs/${id}`,
				init: { method: 'DELETE' },
				onSuccess: () => invalidate('settings:workflows'),
			});
		} catch (error) {
			err = mutationErrorMessage(error, m.common_error());
		}
	}
</script>

<PageHeader title={m.wf_title()} subtitle={m.wf_subtitle()} />

<div class="wrap">
	<div class="card">
		<h3>{m.wf_editWorkflow()}</h3>
		<div class="grid">
			<label>{m.wf_docType()}
				<Select size="sm" bind:value={docType}>
					{#each data.docTypes as dt (dt)}<option value={dt}>{DOC_LABEL[dt] ?? dt}</option>{/each}
				</Select>
			</label>
			<label>{m.wf_name()}<input class="inp" bind:value={name} /></label>
		</div>
		<label class="block">{m.wf_states()}<input class="inp" bind:value={statesText} /></label>
		<label class="block">{m.wf_transitions()}
			<textarea class="inp ta" rows="10" bind:value={transitionsText}></textarea>
		</label>
		<label class="row"><input type="checkbox" bind:checked={enabled} /> {m.wf_enabled()}</label>
		{#if err}<p class="err">{err}</p>{/if}
		<Button onclick={save} disabled={busy || !name.trim()}>{m.wf_saveWorkflow()}</Button>
		<p class="hint">{m.wf_hint()}</p>
	</div>

	{#each data.defs as d (d.id)}
		<div class="card def">
			<div class="def-head">
				<strong>{DOC_LABEL[d.docType] ?? d.docType}</strong> · {d.name}
				{#if !d.enabled}<span class="muted">{m.wf_disabled()}</span>{/if}
				<div class="spacer"></div>
				<Button size="sm" variant="ghost" onclick={() => loadDef(d)}>{m.common_edit()}</Button>
				<Button size="sm" variant="ghost" onclick={() => remove(d.id)}>{m.common_delete()}</Button>
			</div>
			<div class="muted small">{(d.states as string[]).join(' → ')} · {m.wf_transitionsCount({ count: (d.transitions as unknown[]).length })}</div>
		</div>
	{/each}
</div>

<style>
	.wrap { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4) var(--space-page-gutter, 16px); max-width: calc(720px + var(--space-page-gutter, 16px) + var(--space-page-gutter, 16px)); }
	.card { padding: var(--space-4) var(--space-4); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--color-bg2); }
	.card h3 { margin: 0 0 var(--space-2); font-size: var(--font-size-page-title); }
	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-bottom: var(--space-2); }
	label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--font-size-body); opacity: 0.9; }
	.block { margin-bottom: var(--space-2); }
	.row { flex-direction: row; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
	.inp { padding: var(--space-2) var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--color-bg3); color: inherit; font-size: var(--font-size-body); }
	.ta { font-family: var(--font-mono, monospace); font-size: var(--font-size-body); }
	.def-head { display: flex; align-items: center; gap: var(--space-2); }
	.spacer { flex: 1; }
	.muted { opacity: 0.7; }
	.small { font-size: var(--font-size-body); margin-top: var(--space-1); }
	.err { color: var(--color-danger-fg); font-size: var(--font-size-body); }
	.hint { font-size: var(--font-size-body); opacity: 0.65; margin: var(--space-2) 0 0; }
	@media (max-width: 767.98px) {
		.grid { grid-template-columns: minmax(0, 1fr); }
		.def-head { align-items: stretch; flex-wrap: wrap; }
		.def-head .spacer { display: none; }
		.def-head strong { width: 100%; }
	}
</style>
