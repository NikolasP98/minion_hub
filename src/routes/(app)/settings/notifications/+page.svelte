<script lang="ts">
	// Admin UI for the generic notification-rules engine (notif.service). The
	// engine + the per-minute netcup tick + gateway delivery already run in prod;
	// this is the missing surface to DEFINE rules without hand-inserting rows.
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Button, Select } from '$lib/components/ui';
	import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();

	const EVENTS = ['insert', 'update', 'date_offset'];
	const CHANNELS = ['whatsapp', 'telegram', 'email'];
	const TABLE_LABEL: Record<string, string> = {
		support_issues: 'Support tickets',
		sales_orders: 'Sales orders',
		crm_contacts: 'CRM contacts',
		sched_bookings: 'Bookings',
		fin_invoices: 'Invoices',
	};

	let editId = $state<string | null>(null);
	let name = $state('');
	let enabled = $state(true);
	let triggerTable = $state('support_issues');
	let triggerEvent = $state('insert');
	let dateField = $state('');
	let dateOffsetMins = $state(0);
	let channel = $state('whatsapp');
	let accountId = $state('');
	let conditionText = $state('[]');
	let recipientsText = $state('[{ "type": "static", "value": "" }]');
	let template = $state('');
	let err = $state('');
	let busy = $state(false);

	const dateFields = $derived(data.tables.find((t) => t.table === triggerTable)?.dateFields ?? []);

	function reset() {
		editId = null; name = ''; enabled = true; triggerTable = 'support_issues'; triggerEvent = 'insert';
		dateField = ''; dateOffsetMins = 0; channel = 'whatsapp'; accountId = '';
		conditionText = '[]'; recipientsText = '[{ "type": "static", "value": "" }]'; template = ''; err = '';
	}

	function loadRule(r: (typeof data.rules)[number]) {
		editId = r.id; name = r.name; enabled = r.enabled; triggerTable = r.triggerTable; triggerEvent = r.triggerEvent;
		dateField = r.dateField ?? ''; dateOffsetMins = r.dateOffsetMins ?? 0; channel = r.channel; accountId = r.accountId ?? '';
		conditionText = JSON.stringify(r.condition ?? [], null, 2);
		recipientsText = JSON.stringify(r.recipients ?? [], null, 2);
		template = r.template; err = '';
	}

	async function save() {
		err = '';
		let condition: unknown, recipients: unknown;
		try {
			condition = JSON.parse(conditionText);
			recipients = JSON.parse(recipientsText);
			if (!Array.isArray(condition) || !Array.isArray(recipients)) throw new Error('condition and recipients must be arrays');
		} catch (e) {
			err = `Invalid JSON: ${e instanceof Error ? e.message : e}`;
			return;
		}
		if (!name.trim() || !template.trim()) { err = 'Name and template are required.'; return; }
		const payload = {
			name, enabled, triggerTable, triggerEvent, channel,
			accountId: accountId.trim() || null,
			dateField: triggerEvent === 'date_offset' ? (dateField || null) : null,
			dateOffsetMins: triggerEvent === 'date_offset' ? Number(dateOffsetMins) : null,
			condition, recipients, template,
		};
		busy = true;
		try {
			await jsonMutation({
				input: editId ? `/api/notifications/rules/${editId}` : '/api/notifications/rules',
				init: {
					method: editId ? 'PATCH' : 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				},
				onSuccess: async () => {
					reset();
					await invalidate('settings:notifications');
				},
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
				input: `/api/notifications/rules/${id}`,
				init: { method: 'DELETE' },
				onSuccess: async () => {
					if (editId === id) reset();
					await invalidate('settings:notifications');
				},
			});
		} catch (error) {
			err = mutationErrorMessage(error, m.common_error());
		}
	}
</script>

<PageHeader title="Notifications" subtitle="When something happens to a record, message someone over a channel" />

<div class="wrap">
	<div class="card">
		<h3>{editId ? 'Edit rule' : 'New rule'}</h3>
		<div class="grid">
			<label>Name<input class="inp" bind:value={name} placeholder="Urgent ticket → on-call" /></label>
			<label>Channel
				<Select size="sm" bind:value={channel}>{#each CHANNELS as c (c)}<option value={c}>{c}</option>{/each}</Select>
			</label>
			<label>When (table)
				<Select size="sm" bind:value={triggerTable}>{#each data.tables as t (t.table)}<option value={t.table}>{TABLE_LABEL[t.table] ?? t.table}</option>{/each}</Select>
			</label>
			<label>Event
				<Select size="sm" bind:value={triggerEvent}>{#each EVENTS as e (e)}<option value={e}>{e}</option>{/each}</Select>
			</label>
		</div>

		{#if triggerEvent === 'date_offset'}
			<div class="grid">
				<label>Date field
					<Select size="sm" bind:value={dateField}>
						<option value="">—</option>
						{#each dateFields as f (f)}<option value={f}>{f}</option>{/each}
					</Select>
				</label>
				<label>Offset (minutes, negative = before)<input class="inp" type="number" bind:value={dateOffsetMins} /></label>
			</div>
		{/if}

		<label class="block">Account ID (optional — gateway channel account)<input class="inp" bind:value={accountId} /></label>
		<label class="block">Condition (JSON: <code>[{`{ "field": "priority", "op": "eq", "value": "urgent" }`}]</code>)
			<textarea class="inp ta" rows="3" bind:value={conditionText}></textarea>
		</label>
		<label class="block">Recipients (JSON: <code>[{`{ "type": "field"|"static", "value": "phone"|"+51..." }`}]</code>)
			<textarea class="inp ta" rows="3" bind:value={recipientsText}></textarea>
		</label>
		<label class="block">Template (<code>{`{{field}}`}</code> interpolated from the row)
			<textarea class="inp ta" rows="3" bind:value={template} placeholder={'Ticket {{subject}} is now {{status}}'}></textarea>
		</label>
		<label class="row"><input type="checkbox" bind:checked={enabled} /> Enabled</label>
		{#if err}<p class="err">{err}</p>{/if}
		<div class="actions">
			<Button onclick={save} disabled={busy || !name.trim()}>{editId ? 'Update rule' : 'Create rule'}</Button>
			{#if editId}<Button variant="ghost" onclick={reset}>Cancel</Button>{/if}
		</div>
	</div>

	{#each data.rules as r (r.id)}
		<div class="card def">
			<div class="def-head">
				<strong>{r.name}</strong>
				{#if !r.enabled}<span class="muted">(disabled)</span>{/if}
				<div class="spacer"></div>
				<Button size="sm" variant="ghost" onclick={() => loadRule(r)}>Edit</Button>
				<Button size="sm" variant="ghost" onclick={() => remove(r.id)}>Delete</Button>
			</div>
			<div class="muted small">{TABLE_LABEL[r.triggerTable] ?? r.triggerTable} · {r.triggerEvent} → {r.channel}</div>
		</div>
	{:else}
		<p class="muted small">No rules yet. The engine + per-minute tick are live — create a rule and it fires.</p>
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
	.actions { display: flex; gap: var(--space-2); }
	.def-head { display: flex; align-items: center; gap: var(--space-2); }
	.spacer { flex: 1; }
	.muted { opacity: 0.7; }
	.small { font-size: var(--font-size-body); margin-top: var(--space-1); }
	.err { color: var(--color-danger-fg); font-size: var(--font-size-body); }
	code { font-size: var(--font-size-caption); opacity: 0.8; }
	@media (max-width: 767.98px) {
		.grid { grid-template-columns: minmax(0, 1fr); }
		.actions, .def-head { align-items: stretch; flex-wrap: wrap; }
		.def-head .spacer { display: none; }
		.def-head strong { width: 100%; }
	}
</style>
