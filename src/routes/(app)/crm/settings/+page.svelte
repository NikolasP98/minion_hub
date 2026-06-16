<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import {
		ArrowLeft,
		Plus,
		Trash2,
		Tag as TagIcon,
		Tags,
		Radio,
		Settings2,
		Pause,
		Play,
		Check,
	} from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
	import { formatPhoneLike, relativeTime } from '$lib/components/crm/crm-format';

	type Ledger = {
		channel: string;
		accountId: string;
		contacts: number;
		lastActive: string | null;
		name?: string | null;
		phone?: string | null;
	};
	type Managed = Ledger & { label: string | null; paused: boolean };
	type Scope = { added: Managed[]; available: Ledger[]; legacy: boolean };

	let { data }: { data: PageData } = $props();
	const tags = $derived(data.tags);
	// `data.scope` is STREAMED (a promise) so the page never blocks on the gateway
	// RPC behind the account manager; it's unwrapped via {#await} in the Channels
	// tab, where `added`/`available`/`groupedAvailable` are derived locally.

	type Tab = 'tags' | 'channels';
	let tab = $state<Tab>('tags');

	// ── Tag manager ──────────────────────────────────────────────────────────
	// Auto-tag rule fields (must match RULE_FIELDS in crm-scoring.ts).
	const FIELDS = [
		{ v: 'score', label: () => m.crm_field_score() },
		{ v: 'last_days', label: () => m.crm_field_last_days() },
		{ v: 'total_msgs', label: () => m.crm_field_total_msgs() },
		{ v: 'inbound_msgs', label: () => m.crm_field_inbound_msgs() },
		{ v: 'channels_used', label: () => m.crm_field_channels_used() },
		{ v: 'reciprocity', label: () => m.crm_field_reciprocity() },
		{ v: 'stage', label: () => m.crm_field_stage() },
	];
	const OPS = ['>=', '>', '=', '<=', '<', '!='];
	const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];

	let name = $state('');
	let color = $state(COLORS[0]);
	let kind = $state<'manual' | 'auto'>('manual');
	let field = $state('score');
	let op = $state('>=');
	let value = $state('80');
	let busy = $state(false);
	let err = $state('');

	function ruleValue(): number | string {
		// stage is a string field; everything else numeric.
		return field === 'stage' ? value : Number(value);
	}

	async function createTag() {
		if (!name.trim()) return;
		busy = true;
		err = '';
		try {
			const body: Record<string, unknown> = { name: name.trim(), color, kind };
			if (kind === 'auto') body.rule = { field, op, value: ruleValue() };
			const res = await fetch('/api/crm/tags', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (res.ok) {
				name = '';
				await invalidate('crm:tags');
			} else {
				const j = await res.json().catch(() => ({}));
				err = j.message ?? 'Error';
			}
		} finally {
			busy = false;
		}
	}

	async function deleteTag(id: string) {
		await fetch(`/api/crm/tags/${id}`, { method: 'DELETE' });
		await invalidate('crm:tags');
	}

	function ruleSummary(rule: unknown): string {
		if (!rule || typeof rule !== 'object') return '';
		const r = rule as { field?: string; op?: string; value?: unknown };
		if (!r.field) return '';
		return `${r.field} ${r.op} ${r.value}`;
	}

	// ── Account manager ──────────────────────────────────────────────────────
	const keyOf = (a: { channel: string; accountId: string }) => `${a.channel} ${a.accountId}`;

	let addOpen = $state(false);
	let menuKey = $state<string | null>(null);
	let renameKey = $state<string | null>(null);
	let renameValue = $state('');
	let busyKey = $state<string | null>(null);

	function channelLabel(ch: string): string {
		return ch.charAt(0).toUpperCase() + ch.slice(1);
	}
	function accountName(a: {
		accountId: string;
		label?: string | null;
		name?: string | null;
		phone?: string | null;
	}): string {
		if (a.label && a.label.trim()) return a.label; // user-set CRM label wins
		if (a.name && a.name.trim()) return a.name; // canonical gateway account name
		if (a.phone && a.phone.trim()) return formatPhoneLike(a.phone);
		if (!a.accountId || a.accountId === 'default') return m.crm_account_default();
		return formatPhoneLike(a.accountId);
	}

	// Group a list under its channel ("1 of 2 WhatsApp numbers" mental model).
	function groupByChannel<T extends { channel: string }>(list: T[]) {
		const map = new Map<string, T[]>();
		for (const a of list) {
			const arr = map.get(a.channel) ?? [];
			arr.push(a);
			map.set(a.channel, arr);
		}
		return [...map.entries()].map(([channel, items]) => ({ channel, items }));
	}

	async function addAccount(a: Ledger) {
		busyKey = keyOf(a);
		try {
			const res = await fetch('/api/crm/accounts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ channel: a.channel, accountId: a.accountId }),
			});
			if (res.ok) await invalidate('crm:accounts');
		} finally {
			busyKey = null;
			addOpen = false;
		}
	}

	async function patchAccount(a: Managed, patch: { label?: string | null; paused?: boolean }) {
		busyKey = keyOf(a);
		try {
			const res = await fetch('/api/crm/accounts', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ channel: a.channel, accountId: a.accountId, ...patch }),
			});
			if (res.ok) await invalidate('crm:accounts');
		} finally {
			busyKey = null;
		}
	}

	async function removeAccount(a: Managed) {
		busyKey = keyOf(a);
		menuKey = null;
		try {
			const q = new URLSearchParams({ channel: a.channel, accountId: a.accountId });
			const res = await fetch(`/api/crm/accounts?${q}`, { method: 'DELETE' });
			if (res.ok) await invalidate('crm:accounts');
		} finally {
			busyKey = null;
		}
	}

	function startRename(a: Managed) {
		renameKey = keyOf(a);
		renameValue = a.label ?? '';
	}
	async function saveRename(a: Managed) {
		await patchAccount(a, { label: renameValue.trim() || null });
		renameKey = null;
		menuKey = null;
	}
	async function togglePause(a: Managed) {
		menuKey = null;
		await patchAccount(a, { paused: !a.paused });
	}
</script>

<svelte:head><title>{m.crm_settings_title()} — {m.crm_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.crm_settings_title()} subtitle={m.crm_settings_subtitle()}>
		{#snippet leading()}
			<a href="/crm" class="p-1 -ml-1 rounded hover:bg-white/[0.06] inline-flex" aria-label={m.crm_back_to_contacts()}>
				<ArrowLeft size={16} />
			</a>
		{/snippet}
	</PageHeader>

	<!-- Tabs -->
	<div class="flex items-center gap-1 px-4 pt-3 border-b border-[var(--hairline)]">
		<button class="tab" class:active={tab === 'tags'} onclick={() => (tab = 'tags')}>
			<Tags size={14} /> {m.crm_tab_tags()}
		</button>
		<button class="tab" class:active={tab === 'channels'} onclick={() => (tab = 'channels')}>
			<Radio size={14} /> {m.crm_tab_channels()}
		</button>
	</div>

	<div class="flex-1 min-h-0 overflow-auto p-4">
		{#if tab === 'tags'}
			<div class="grid gap-4 lg:grid-cols-[1fr_1.2fr] max-w-4xl">
				<!-- Create -->
				<section class="card">
					<header class="card-h"><span>{m.crm_new_tag()}</span></header>
					<label class="field">
						<span class="t-caption">{m.crm_tag_name()}</span>
						<input bind:value={name} class="inp" placeholder={m.crm_tag_name()} />
					</label>

					<label class="field">
						<span class="t-caption">{m.crm_tag_color()}</span>
						<div class="swatches">
							{#each COLORS as c (c)}
								<button type="button" class="swatch" class:sel={color === c} style:background={c} onclick={() => (color = c)} aria-label={c}></button>
							{/each}
						</div>
					</label>

					<label class="field">
						<span class="t-caption">{m.crm_tag_type()}</span>
						<select bind:value={kind} class="inp">
							<option value="manual">{m.crm_tag_kind_manual()}</option>
							<option value="auto">{m.crm_tag_kind_auto()}</option>
						</select>
					</label>

					{#if kind === 'auto'}
						<div class="rule">
							<span class="t-caption">{m.crm_auto_rule()}</span>
							<div class="rule-row">
								<select bind:value={field} class="inp">
									{#each FIELDS as f (f.v)}<option value={f.v}>{f.label()}</option>{/each}
								</select>
								<select bind:value={op} class="inp w-16">
									{#each OPS as o (o)}<option value={o}>{o}</option>{/each}
								</select>
								<input bind:value class="inp w-24" placeholder={m.crm_rule_value()} />
							</div>
						</div>
					{/if}

					{#if err}<p class="err">{err}</p>{/if}
					<Button variant="primary" size="sm" onclick={createTag} disabled={busy || !name.trim()}>
						<Plus size={14} /> {m.crm_create()}
					</Button>
				</section>

				<!-- List -->
				<section class="card">
					<header class="card-h"><span>{m.crm_manage_tags()}</span></header>
					{#if tags.length === 0}
						<p class="t-caption">{m.crm_no_tags()}</p>
					{:else}
						<ul class="taglist">
							{#each tags as t (t.id)}
								<li>
									<span class="chip" style:--c={t.color ?? 'var(--color-accent)'}>
										<TagIcon size={11} />{t.name}
									</span>
									{#if t.kind === 'auto'}
										<span class="auto">{m.crm_auto_badge()}: {ruleSummary(t.rule)}</span>
									{/if}
									<button class="del" onclick={() => deleteTag(t.id)} aria-label={m.crm_delete()}><Trash2 size={13} /></button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			</div>
		{:else}
			{#await data.scope}
				<section class="card max-w-2xl">
					<div class="card-h" style="margin:0">{m.crm_channels_title()}</div>
					<p class="t-caption mt-1">{m.crm_channels_subtitle()}</p>
					<ul class="acclist" aria-busy="true">
						<li class="accrow skel"></li>
						<li class="accrow skel"></li>
						<li class="accrow skel"></li>
					</ul>
				</section>
			{:then scope}
				{@const added = scope.added}
				{@const available = scope.available}
				{@const groupedAvailable = groupByChannel(available)}
				<section class="card max-w-2xl">
				<header class="acc-head">
					<div>
						<div class="card-h" style="margin:0">{m.crm_channels_title()}</div>
						<p class="t-caption mt-1">{m.crm_channels_subtitle()}</p>
					</div>
					<div class="add-wrap">
						<Button variant="outline" size="sm" onclick={() => (addOpen = !addOpen)}>
							<Plus size={14} /> {m.crm_accounts_add()}
						</Button>
						{#if addOpen}
							<button class="backdrop" aria-label="close" onclick={() => (addOpen = false)}></button>
							<div class="add-menu">
								<div class="add-menu-h">{m.crm_accounts_add_heading()}</div>
								{#if available.length === 0}
									<p class="t-caption add-empty">{m.crm_accounts_available_none()}</p>
								{:else}
									{#each groupedAvailable as g (g.channel)}
										<div class="add-group">
											<div class="add-group-h"><ChannelBrandIcon channel={g.channel} size={13} /> {channelLabel(g.channel)}</div>
											{#each g.items as a (keyOf(a))}
												<button class="add-item" disabled={busyKey === keyOf(a)} onclick={() => addAccount(a)}>
													<span class="add-item-name">{accountName(a)}</span>
													<span class="t-caption">{m.crm_channel_contacts({ count: a.contacts })}</span>
												</button>
											{/each}
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				</header>

				{#if added.length === 0}
					<p class="t-caption empty-added">{m.crm_accounts_none_added()}</p>
				{:else}
					<ul class="acclist">
						{#each added as a (keyOf(a))}
							<li class="accrow" class:paused={a.paused}>
								<ChannelBrandIcon channel={a.channel} size={18} />
								<div class="accinfo">
									{#if renameKey === keyOf(a)}
										<div class="rename">
											<input
												class="rename-inp"
												bind:value={renameValue}
												placeholder={accountName(a)}
												onkeydown={(e) => { if (e.key === 'Enter') saveRename(a); if (e.key === 'Escape') (renameKey = null); }}
											/>
											<button class="icon-btn" aria-label={m.crm_save()} onclick={() => saveRename(a)}><Check size={14} /></button>
										</div>
									{:else}
										<span class="accname">{accountName(a)}</span>
										<span class="t-caption">
											{m.crm_channel_contacts({ count: a.contacts })}{#if a.lastActive} · {m.crm_channel_last_active({ when: relativeTime(a.lastActive) })}{/if}
										</span>
									{/if}
								</div>

								<span class="state" class:on={!a.paused}>
									{a.paused ? m.crm_account_status_paused() : m.crm_account_status_active()}
								</span>

								<div class="menu-wrap">
									<button
										class="icon-btn"
										aria-label={m.crm_account_manage()}
										disabled={busyKey === keyOf(a)}
										onclick={() => (menuKey = menuKey === keyOf(a) ? null : keyOf(a))}
									>
										<Settings2 size={16} />
									</button>
									{#if menuKey === keyOf(a)}
										<button class="backdrop" aria-label="close" onclick={() => (menuKey = null)}></button>
										<div class="menu">
											<button class="mi" onclick={() => { startRename(a); menuKey = null; }}>{m.crm_account_rename()}</button>
											<button class="mi" onclick={() => togglePause(a)}>
												{#if a.paused}<Play size={14} /> {m.crm_account_resume()}{:else}<Pause size={14} /> {m.crm_account_pause()}{/if}
											</button>
											<div class="msep"></div>
											<button class="mi danger" onclick={() => removeAccount(a)}><Trash2 size={14} /> {m.crm_account_remove()}</button>
										</div>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
			{/await}
		{/if}
	</div>
</div>

<style>
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.75rem;
		font-size: 0.85rem;
		color: var(--color-muted-foreground);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tab:hover {
		color: var(--color-foreground);
	}
	.tab.active {
		color: var(--color-accent);
		border-bottom-color: var(--color-accent);
	}
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		padding: 0.85rem 1rem;
	}
	.card-h {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-bottom: 0.7rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.7rem;
	}
	.inp {
		height: 2rem;
		padding: 0 0.6rem;
		font-size: 0.85rem;
		border-radius: var(--radius-md);
		background: var(--color-bg3);
		border: 1px solid var(--hairline);
	}
	.swatches {
		display: flex;
		gap: 0.4rem;
	}
	.swatch {
		width: 22px;
		height: 22px;
		border-radius: 999px;
		border: 2px solid transparent;
	}
	.swatch.sel {
		border-color: var(--color-foreground);
	}
	.rule {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.7rem;
		padding: 0.6rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-accent) 6%, transparent);
	}
	.rule-row {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.err {
		color: var(--color-destructive);
		font-size: 0.8rem;
		margin-bottom: 0.5rem;
	}
	.taglist {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.taglist li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.12rem 0.55rem;
		border-radius: 999px;
		font-size: 0.78rem;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
	}
	.auto {
		font-size: 0.72rem;
		color: var(--color-muted-foreground);
		font-family: var(--font-mono, monospace);
	}
	.del {
		margin-left: auto;
		opacity: 0.6;
		display: grid;
		place-items: center;
	}
	.del:hover {
		opacity: 1;
		color: var(--color-destructive);
	}

	/* account manager */
	.acc-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.9rem;
	}
	.add-wrap {
		position: relative;
		flex-shrink: 0;
	}
	.empty-added {
		padding: 0.5rem 0;
	}
	.acclist {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.accrow {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--color-bg3);
	}
	.accrow.paused {
		opacity: 0.62;
	}
	.accrow.skel {
		height: 2.6rem;
		border-style: dashed;
		animation: skel-pulse 1.2s ease-in-out infinite;
	}
	@keyframes skel-pulse {
		0%, 100% { opacity: 0.35; }
		50% { opacity: 0.7; }
	}
	.accinfo {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		min-width: 0;
		flex: 1;
	}
	.accname {
		font-size: 0.9rem;
		font-weight: 600;
	}
	.rename {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.rename-inp {
		height: 1.8rem;
		flex: 1;
		max-width: 16rem;
		padding: 0 0.5rem;
		font-size: 0.85rem;
		border-radius: var(--radius-md);
		background: var(--color-bg);
		border: 1px solid var(--hairline);
	}
	.state {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground);
	}
	.state.on {
		color: var(--color-success, var(--color-emerald));
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: var(--radius-md);
		color: var(--color-muted-foreground);
		flex-shrink: 0;
	}
	.icon-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-foreground);
	}
	.icon-btn:disabled {
		opacity: 0.5;
	}

	/* dropdowns (add picker + per-account config menu) */
	.menu-wrap {
		position: relative;
		display: inline-flex;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: transparent;
	}
	.menu,
	.add-menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 41;
		min-width: 12rem;
		background: var(--color-card);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		padding: 0.3rem;
	}
	.add-menu {
		width: 17rem;
		max-height: 20rem;
		overflow: auto;
	}
	.add-menu-h,
	.add-group-h {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground);
		padding: 0.3rem 0.4rem;
	}
	.add-group-h {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.add-empty {
		padding: 0.4rem;
	}
	.add-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-sm, 6px);
		text-align: left;
	}
	.add-item:hover {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}
	.add-item:disabled {
		opacity: 0.5;
	}
	.add-item-name {
		font-size: 0.86rem;
		font-weight: 500;
	}
	.mi {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-sm, 6px);
		font-size: 0.84rem;
		text-align: left;
		color: var(--color-foreground);
	}
	.mi:hover {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}
	.mi.danger {
		color: var(--color-destructive);
	}
	.mi.danger:hover {
		background: color-mix(in srgb, var(--color-destructive) 12%, transparent);
	}
	.msep {
		height: 1px;
		background: var(--hairline);
		margin: 0.2rem 0;
	}
</style>
