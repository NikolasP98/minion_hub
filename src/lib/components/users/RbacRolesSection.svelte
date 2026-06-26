<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { ShieldCheck, Users, RotateCcw, Lock } from 'lucide-svelte';
	import { toastError } from '$lib/state/ui/toast.svelte';

	type ActionSet = Record<string, boolean>;
	type RoleModuleCaps = { module: string; label: string; caps: ActionSet; overridden: boolean };
	type Role = {
		key: string;
		name: string;
		rank: number;
		description: string | null;
		isSystem: boolean;
		memberCount: number;
		modules: RoleModuleCaps[];
	};

	interface Props {
		roles: Role[];
		actions: string[];
		businessModules: string[];
		adminModules: string[];
	}
	let { roles, actions, businessModules, adminModules }: Props = $props();

	// svelte-ignore state_referenced_locally
	let selectedKey = $state<string>(roles[0]?.key ?? '');
	let saving = $state<string | null>(null); // `${roleKey}:${module}` currently saving

	const selected = $derived(roles.find((r) => r.key === selectedKey) ?? roles[0] ?? null);
	// Owner is intentionally not editable — it must always retain full access (no self-lockout).
	const editable = $derived(!!selected && selected.key !== 'owner');

	function capsFor(role: Role, mod: string): RoleModuleCaps | undefined {
		return role.modules.find((m) => m.module === mod);
	}

	async function toggleCell(mod: string, action: string, next: boolean) {
		if (!selected || !editable) return;
		const rm = capsFor(selected, mod);
		if (!rm) return;
		const caps = { ...rm.caps, [action]: next };
		const tag = `${selected.key}:${mod}`;
		saving = tag;
		// optimistic
		rm.caps = caps;
		rm.overridden = true;
		try {
			const res = await fetch('/api/roles/overrides', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ roleKey: selected.key, module: mod, caps }),
			});
			if (!res.ok) throw new Error(String(res.status));
			void invalidate('settings:roles');
		} catch {
			toastError('Could not save permission change.');
			void invalidate('settings:roles');
		} finally {
			saving = null;
		}
	}

	async function resetModule(mod: string) {
		if (!selected || !editable) return;
		const tag = `${selected.key}:${mod}`;
		saving = tag;
		try {
			const res = await fetch('/api/roles/overrides', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ roleKey: selected.key, module: mod }),
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			toastError('Could not reset to default.');
		} finally {
			saving = null;
			void invalidate('settings:roles'); // refresh to the code default
		}
	}
</script>

{#snippet matrix(title: string, mods: string[])}
	<section>
		<h4 class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h4>
		<div class="overflow-x-auto rounded-md border border-border bg-bg2/40">
			<table class="w-full text-[12px]">
				<thead>
					<tr class="border-b border-border/60 text-muted">
						<th class="px-3 py-2 text-left font-medium">Module</th>
						{#each actions as a (a)}
							<th class="px-2 py-2 text-center font-medium capitalize">{a}</th>
						{/each}
						<th class="w-8"></th>
					</tr>
				</thead>
				<tbody>
					{#each mods as mod (mod)}
						{@const rm = selected ? capsFor(selected, mod) : undefined}
						{#if rm}
							<tr class="border-b border-border/30 last:border-0">
								<td class="px-3 py-1.5 text-foreground">
									<span class="flex items-center gap-1.5">
										{rm.label}
										{#if rm.overridden}
											<span
												class="h-1.5 w-1.5 rounded-full bg-accent"
												title="Customised for this organization"
											></span>
										{/if}
									</span>
								</td>
								{#each actions as a (a)}
									<td class="px-2 py-1.5 text-center">
										<input
											type="checkbox"
											class="accent-accent disabled:opacity-40"
											checked={rm.caps[a] ?? false}
											disabled={!editable || saving === `${selected?.key}:${mod}`}
											onchange={(e) => toggleCell(mod, a, e.currentTarget.checked)}
										/>
									</td>
								{/each}
								<td class="px-1 py-1.5 text-center">
									{#if editable && rm.overridden}
										<button
											class="rounded p-1 text-muted hover:bg-muted/20 hover:text-foreground"
											title="Reset to default"
											onclick={() => resetModule(mod)}
										>
											<RotateCcw class="h-3 w-3" />
										</button>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/snippet}

<section class="mx-auto max-w-6xl min-h-0 flex-1 overflow-y-auto px-4 pt-6">
	<header class="mb-5">
		<h2 class="text-base font-semibold text-foreground">Roles</h2>
		<p class="mt-0.5 text-[12px] text-muted">
			What each role can see and do across the dashboard. Built-in roles ship with sensible
			defaults — customise any of them for this organization. The agent inherits the signed-in
			user's permissions.
		</p>
	</header>

	<div class="grid grid-cols-1 items-start gap-4 md:grid-cols-[280px_1fr]">
		<!-- Sidebar -->
		<aside class="overflow-hidden rounded-lg border border-border bg-card">
			<div class="border-b border-border/60 px-3 py-2.5">
				<span class="text-[11px] font-semibold uppercase tracking-wider text-muted">All roles</span>
			</div>
			<ul class="divide-y divide-border/40">
				{#each roles as r (r.key)}
					{@const active = r.key === selectedKey}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors {active
								? 'bg-accent/10'
								: 'hover:bg-muted/20'}"
							onclick={() => (selectedKey = r.key)}
						>
							<span class="h-1.5 w-1.5 rounded-full {active ? 'bg-accent' : 'bg-muted/50'}"></span>
							<span class="min-w-0 flex-1">
								<span class="flex items-center gap-1.5">
									<span class="truncate text-[13px] font-medium text-foreground">{r.name}</span>
									{#if r.key === 'owner'}
										<Lock class="h-3 w-3 text-muted" />
									{:else if r.isSystem}
										<ShieldCheck class="h-3 w-3 text-muted" />
									{/if}
								</span>
								{#if r.description}
									<span class="block truncate text-[11px] text-muted">{r.description}</span>
								{/if}
							</span>
							<span class="inline-flex items-center gap-1 text-[10px] text-muted">
								<Users class="h-3 w-3" />
								{r.memberCount}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</aside>

		<!-- Detail -->
		<div class="rounded-lg border border-border bg-card">
			{#if selected}
				<div class="space-y-5 p-5">
					<div class="flex items-center gap-2">
						<h3 class="text-[15px] font-semibold text-foreground">{selected.name}</h3>
						{#if selected.key === 'owner'}
							<span
								class="inline-flex items-center gap-1 rounded bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted"
							>
								<Lock class="h-3 w-3" /> Full access (locked)
							</span>
						{:else if selected.isSystem}
							<span
								class="inline-flex items-center gap-1 rounded bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted"
							>
								<ShieldCheck class="h-3 w-3" /> Built-in
							</span>
						{/if}
						<span class="ml-auto inline-flex items-center gap-1 text-[11px] text-muted">
							<Users class="h-3 w-3" />
							{selected.memberCount} member{selected.memberCount === 1 ? '' : 's'}
						</span>
					</div>
					{#if selected.description}
						<p class="-mt-3 text-[12px] text-muted">{selected.description}</p>
					{/if}

					{@render matrix('Business data', businessModules)}
					{@render matrix('Platform & admin', adminModules)}
				</div>
			{:else}
				<div class="p-10 text-center text-[12px] text-muted">No roles found.</div>
			{/if}
		</div>
	</div>
</section>
