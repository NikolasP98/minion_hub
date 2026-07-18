<script lang="ts">
	// Pulse settings: enable, briefing time, locale, delivery channel, watch toggles.
	// auto_approve graduation switches are scaffold-only in slice 1 — see below.
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Button, Select, Toggle } from '$lib/components/ui';
	import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';

	let { data }: { data: PageData } = $props();

	const LOCALES = [
		{ value: 'en', label: 'English' },
		{ value: 'es', label: 'Español' },
	];
	const CHANNELS = [
		{ value: 'whatsapp', label: 'WhatsApp' },
		{ value: 'telegram', label: 'Telegram' },
		{ value: 'email', label: 'Email' },
	];

	// svelte-ignore state_referenced_locally -- seeding editable form state once from the load prop
	let enabled = $state(data.settings.enabled);
	// svelte-ignore state_referenced_locally
	let briefingTime = $state(data.settings.briefingTime);
	// svelte-ignore state_referenced_locally
	let locale = $state(data.settings.locale);
	// svelte-ignore state_referenced_locally
	let channel = $state(data.settings.channels[0] ?? 'whatsapp');
	// svelte-ignore state_referenced_locally
	let watchEmail = $state(data.settings.watch.email);
	// svelte-ignore state_referenced_locally
	let watchWhatsapp = $state(data.settings.watch.whatsapp);
	// svelte-ignore state_referenced_locally
	let watchCalendar = $state(data.settings.watch.calendar);

	let err = $state('');
	let busy = $state(false);

	async function save() {
		err = '';
		busy = true;
		try {
			await jsonMutation({
				input: '/api/pulse/settings',
				init: {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						enabled,
						briefingTime,
						locale,
						channels: [channel],
						watch: { email: watchEmail, whatsapp: watchWhatsapp, calendar: watchCalendar },
					}),
				},
				onSuccess: async () => {
					await invalidate('settings:pulse');
				},
			});
		} catch (error) {
			err = mutationErrorMessage(error, 'Something went wrong.');
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title="Pulse" subtitle="Daily briefing: enable, schedule, and what it watches." />

<div class="wrap">
	<div class="card">
		<Toggle bind:checked={enabled} label="Enable Pulse" description="Send a daily briefing on the schedule below." />

		<div class="grid">
			<label class="field">
				<span class="field-label">Briefing time</span>
				<input class="inp" type="time" bind:value={briefingTime} />
			</label>
			<label class="field">
				<span class="field-label">Locale</span>
				<Select size="sm" bind:value={locale} options={LOCALES} />
			</label>
			<label class="field">
				<span class="field-label">Channel</span>
				<Select size="sm" bind:value={channel} options={CHANNELS} />
			</label>
		</div>

		<h3>Watch</h3>
		<div class="watch-row">
			<Toggle bind:checked={watchEmail} label="Email" />
			<Toggle bind:checked={watchWhatsapp} label="WhatsApp" />
			<Toggle bind:checked={watchCalendar} label="Calendar" />
		</div>

		<h3>Auto-approve</h3>
		<!-- ponytail: auto_approve is scaffold only — graduation ramp (per-kind auto-execute) is slice 2 -->
		<p class="hint">Coming soon — auto-approve rules per proposal kind.</p>
		<div class="watch-row">
			<Toggle checked={false} disabled label="Reminders" />
			<Toggle checked={false} disabled label="Calendar events" />
		</div>

		{#if err}<p class="err">{err}</p>{/if}
		<div class="actions">
			<Button onclick={save} disabled={busy}>Save</Button>
		</div>
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-page-gutter, 16px);
		max-width: calc(720px + var(--space-page-gutter, 16px) + var(--space-page-gutter, 16px));
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-4);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--color-surface-1);
	}
	.card h3 {
		margin: 0;
		font-size: var(--font-size-page-title);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: var(--space-2);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.field-label {
		font-size: var(--font-size-body);
		color: var(--color-text-secondary);
	}
	.inp {
		padding: var(--space-2) var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		color: var(--color-text-primary);
		font-size: var(--font-size-body);
	}
	.watch-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-caption);
		color: var(--color-text-tertiary);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.err {
		color: var(--color-danger-fg);
		font-size: var(--font-size-body);
	}
	@media (max-width: 767.98px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
