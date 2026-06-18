<script lang="ts">
	import type { PageData } from './$types';
	import { Users, Plus, Trash2, ChevronRight, CalendarPlus, Check, Clock } from 'lucide-svelte';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Card, Button, Input, EmptyState, Badge } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import AvailabilityEditor from '$lib/components/scheduling/AvailabilityEditor.svelte';
	import MemberCalendarStrip from '$lib/components/scheduling/MemberCalendarStrip.svelte';

	let { data }: { data: PageData } = $props();

	type Member = PageData['members'][number];

	const eventTitle = (id: string) => data.eventTypes.find((e) => e.id === id)?.title ?? '';

	// Bookings for one resource this week, with event-type titles resolved.
	function stripBookings(resourceId: string) {
		return data.bookings
			.filter((b) => b.resourceId === resourceId)
			.map((b) => ({
				id: b.id,
				start: b.start,
				end: b.end,
				status: b.status,
				attendeeName: b.attendeeName,
				title: eventTitle(b.eventTypeId),
			}));
	}

	// Link each native org member (person accounts) to their scheduling resource.
	const resourceByProfile = $derived(
		new Map(data.resources.filter((r) => r.profileId).map((r) => [r.profileId as string, r])),
	);
	const roster = $derived(
		data.members
			.filter((mb) => mb.accountType !== 'service')
			.map((mb) => ({ member: mb, resource: resourceByProfile.get(mb.id) ?? null })),
	);
	// Resources not tied to an org member: rooms, equipment, manually-added staff.
	const otherResources = $derived(data.resources.filter((r) => !r.profileId));

	let expanded = $state<string | null>(null);
	let busy = $state<string | null>(null);

	function initials(mb: Member): string {
		const src = mb.displayName || mb.email || '?';
		return src
			.split(/\s+/)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase() ?? '')
			.join('');
	}

	async function enroll(mb: Member) {
		busy = mb.id;
		try {
			const res = await fetch('/api/scheduling/resources', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: mb.displayName || mb.email || 'Team member',
					email: mb.email || null,
					profileId: mb.id,
				}),
			});
			if (res.ok) await invalidate('scheduling:data');
		} finally {
			busy = null;
		}
	}

	async function toggleActive(id: string, active: boolean) {
		await fetch(`/api/scheduling/resources/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ active }),
		});
		await invalidate('scheduling:data');
	}

	async function remove(id: string) {
		await fetch(`/api/scheduling/resources/${id}`, { method: 'DELETE' });
		await invalidate('scheduling:data');
	}

	// ── Custom (non-user) resource: rooms / equipment ─────────────────────────────
	let showAdd = $state(false);
	let name = $state('');
	let email = $state('');
	let timezone = $state('America/Lima');
	let adding = $state(false);

	async function addCustom() {
		if (!name.trim()) return;
		adding = true;
		try {
			const res = await fetch('/api/scheduling/resources', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, email: email || null, timezone }),
			});
			if (res.ok) {
				name = '';
				email = '';
				showAdd = false;
				await invalidate('scheduling:data');
			}
		} finally {
			adding = false;
		}
	}
</script>

<svelte:head><title>{m.sched_resources_title()} · {m.nav_scheduling()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.sched_resources_title()} subtitle={m.sched_team_subtitle()}>
		{#snippet leading()}
			<Users size={16} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<Button size="sm" variant="ghost" onclick={() => (showAdd = !showAdd)}>
				<Plus size={14} /> {m.sched_team_add_custom()}
			</Button>
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
		{#if showAdd}
			<Card padding="md">
				<div class="t-label mb-2">{m.sched_team_add_custom()}</div>
				<div class="flex flex-wrap items-end gap-2">
					<label class="field">
						<span class="t-caption">{m.sched_resource_name()}</span>
						<Input bind:value={name} placeholder="Sala 1 / Equipo…" />
					</label>
					<label class="field">
						<span class="t-caption">{m.sched_resource_email()}</span>
						<Input bind:value={email} placeholder="email@…" />
					</label>
					<label class="field">
						<span class="t-caption">{m.sched_resource_timezone()}</span>
						<Input bind:value={timezone} />
					</label>
					<Button onclick={addCustom} disabled={adding || !name.trim()}>
						<Plus size={14} /> {m.sched_resource_new()}
					</Button>
				</div>
			</Card>
		{/if}

		<!-- ── Native org members ──────────────────────────────────────────────── -->
		<section class="flex flex-col gap-2">
			<div class="t-label">{m.sched_team_members_heading()}</div>

			{#if roster.length === 0}
				<EmptyState title={m.sched_team_no_members()} />
			{:else}
				{#each roster as { member, resource } (member.id)}
					{@const color = resource?.color ?? 'var(--accent)'}
					<Card padding="md">
						<div class="flex items-center gap-3">
							{#if resource}
								<button
									class="icon-btn"
									onclick={() => (expanded = expanded === resource.id ? null : resource.id)}
									aria-label="toggle"
								>
									<ChevronRight
										size={16}
										style="transform:rotate({expanded === resource.id ? 90 : 0}deg);transition:transform .15s"
									/>
								</button>
							{:else}
								<span class="icon-btn-spacer"></span>
							{/if}

							<span class="avatar" style="--c:{color}">{initials(member)}</span>

							<div class="flex-1 min-w-0">
								<div class="font-medium truncate flex items-center gap-2">
									{member.displayName || member.email || '—'}
									{#if member.role === 'admin'}<Badge variant="semantic" value="brand" size="sm">admin</Badge>{/if}
								</div>
								<div class="t-caption truncate">
									{member.email ?? ''}{#if resource}
										· {resource.timezone}{/if}
								</div>
							</div>

							{#if resource}
								<Badge variant="semantic" value={resource.active ? 'success' : 'warning'} size="sm" dot>
									{resource.active ? m.sched_team_enrolled() : m.sched_resource_active()}
								</Badge>
								<label class="t-caption flex items-center gap-1 shrink-0">
									<input
										type="checkbox"
										checked={resource.active}
										onchange={(e) => toggleActive(resource.id, e.currentTarget.checked)}
									/>
									{m.sched_resource_active()}
								</label>
								<button class="icon-btn del" onclick={() => remove(resource.id)} aria-label={m.sched_delete()}>
									<Trash2 size={15} />
								</button>
							{:else}
								<Button size="sm" onclick={() => enroll(member)} disabled={busy === member.id}>
									<CalendarPlus size={14} /> {m.sched_team_enable()}
								</Button>
							{/if}
						</div>

						{#if resource && expanded === resource.id}
							<div class="mt-3 pt-3 border-t border-[var(--hairline)] grid gap-4 lg:grid-cols-[1fr_auto]">
								<div class="min-w-0">
									<div class="t-label mb-2 flex items-center gap-1.5">
										<CalendarPlus size={13} class="text-accent" />
										{m.sched_team_this_week()}
									</div>
									<MemberCalendarStrip weekStart={data.weekStart} bookings={stripBookings(resource.id)} {color} />
								</div>
								<div class="lg:border-l lg:pl-4 border-[var(--hairline)] min-w-[220px]">
									<div class="t-label mb-2 flex items-center gap-1.5">
										<Clock size={13} class="text-accent" />
										{m.sched_availability_title()}
									</div>
									<AvailabilityEditor resourceId={resource.id} schedule={data.schedules[resource.id]} />
								</div>
							</div>
						{/if}
					</Card>
				{/each}
			{/if}
		</section>

		<!-- ── Other resources (rooms / equipment / manual) ────────────────────── -->
		{#if otherResources.length > 0}
			<section class="flex flex-col gap-2">
				<div class="t-label">{m.sched_team_other_resources()}</div>
				{#each otherResources as r (r.id)}
					{@const color = r.color ?? 'var(--accent)'}
					<Card padding="md">
						<div class="flex items-center gap-3">
							<button class="icon-btn" onclick={() => (expanded = expanded === r.id ? null : r.id)} aria-label="toggle">
								<ChevronRight
									size={16}
									style="transform:rotate({expanded === r.id ? 90 : 0}deg);transition:transform .15s"
								/>
							</button>
							<span class="avatar room" style="--c:{color}"><Check size={14} /></span>
							<div class="flex-1 min-w-0">
								<div class="font-medium truncate">{r.name}</div>
								<div class="t-caption truncate">{r.email ?? ''} · {r.timezone}</div>
							</div>
							<label class="t-caption flex items-center gap-1 shrink-0">
								<input
									type="checkbox"
									checked={r.active}
									onchange={(e) => toggleActive(r.id, e.currentTarget.checked)}
								/>
								{m.sched_resource_active()}
							</label>
							<button class="icon-btn del" onclick={() => remove(r.id)} aria-label={m.sched_delete()}>
								<Trash2 size={15} />
							</button>
						</div>
						{#if expanded === r.id}
							<div class="mt-3 pt-3 border-t border-[var(--hairline)] grid gap-4 lg:grid-cols-[1fr_auto]">
								<div class="min-w-0">
									<div class="t-label mb-2">{m.sched_team_this_week()}</div>
									<MemberCalendarStrip weekStart={data.weekStart} bookings={stripBookings(r.id)} {color} />
								</div>
								<div class="lg:border-l lg:pl-4 border-[var(--hairline)] min-w-[220px]">
									<div class="t-label mb-2">{m.sched_availability_title()}</div>
									<AvailabilityEditor resourceId={r.id} schedule={data.schedules[r.id]} />
								</div>
							</div>
						{/if}
					</Card>
				{/each}
			</section>
		{/if}
	</div>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
		border-radius: 6px;
		padding: 0.25rem;
	}
	.icon-btn:hover {
		background: var(--hairline);
	}
	.icon-btn.del:hover {
		color: var(--color-destructive);
	}
	.icon-btn-spacer {
		width: 26px;
		display: inline-block;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		flex-shrink: 0;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 16%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
	}
	.avatar.room {
		border-radius: var(--radius-md, 8px);
	}
</style>
