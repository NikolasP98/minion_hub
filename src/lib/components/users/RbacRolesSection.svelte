<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { ShieldCheck, Users, RotateCcw, Lock, ChevronRight, ChevronDown, UserCheck, EyeOff } from 'lucide-svelte';
	import { toastError } from '$lib/state/ui/toast.svelte';
	import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';

	type ActionSet = Record<string, boolean>;
	type SubResourceCaps = { key: string; label: string; caps: ActionSet; overridden: boolean };
	type RoleModuleCaps = {
		module: string;
		label: string;
		caps: ActionSet;
		overridden: boolean;
		subResources: SubResourceCaps[];
		ifOwner: boolean;
		ownerScopable: boolean;
		fieldLevel: number;
		fieldScopable: boolean;
	};
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
	let saving = $state<string | null>(null); // override key currently saving
	let expanded = $state<Record<string, boolean>>({});

	const selected = $derived(roles.find((r) => r.key === selectedKey) ?? roles[0] ?? null);
	// Owner is intentionally not editable — it must always retain full access (no self-lockout).
	const editable = $derived(!!selected && selected.key !== 'owner');
	const EMPTY: ActionSet = { view: false, create: false, edit: false, delete: false, export: false, manage: false };

	function capsFor(role: Role, mod: string): RoleModuleCaps | undefined {
		return role.modules.find((m) => m.module === mod);
	}

	/**
	 * Apply the action-dependency invariant locally for the optimistic update:
	 * every action requires `view`, so unchecking view clears the row, and
	 * checking any other action turns view on. Mirrors the server normalization.
	 */
	function applyViewDep(caps: ActionSet, action: string, next: boolean): ActionSet {
		if (action === 'view' && !next) return { ...EMPTY };
		const out = { ...caps, [action]: next };
		if (action !== 'view' && next) out.view = true;
		return out;
	}

	async function saveOverride(moduleKey: string, caps: ActionSet, ifOwner = false, fieldLevel?: number) {
		const res = await fetch('/api/roles/overrides', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ roleKey: selected!.key, module: moduleKey, caps, ifOwner, fieldLevel }),
		});
		if (!res.ok) throw new Error(String(res.status));
	}
	async function clearOverride(moduleKey: string) {
		const res = await fetch('/api/roles/overrides', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ roleKey: selected!.key, module: moduleKey }),
		});
		if (!res.ok) throw new Error(String(res.status));
	}

	// Aggregate state of a parent action across the module + its sub-resources:
	// checked when ALL are on, indeterminate when they diverge.
	function parentState(rm: RoleModuleCaps, action: string): { checked: boolean; indeterminate: boolean } {
		const vals = [rm.caps[action] ?? false, ...rm.subResources.map((s) => s.caps[action] ?? false)];
		const all = vals.every(Boolean);
		const none = vals.every((v) => !v);
		return { checked: all, indeterminate: !all && !none };
	}

	// Toggling the group header cascades to the parent module AND every child:
	// the parent gets the new caps, child overrides are cleared so they inherit it.
	async function toggleParent(rm: RoleModuleCaps, action: string, next: boolean) {
		if (!selected || !editable) return;
		const caps = applyViewDep(rm.caps, action, next);
		saving = rm.module;
		const dirtySubs = rm.subResources.filter((s) => s.overridden).map((s) => s.key);
		// optimistic: parent + all children follow
		rm.caps = caps;
		rm.overridden = true;
		for (const s of rm.subResources) {
			s.caps = caps;
			s.overridden = false;
		}
		try {
			// preserve owner-scope + field-level on cap edits
			await saveOverride(rm.module, caps, rm.ifOwner, rm.fieldLevel);
			await Promise.all(dirtySubs.map((k) => clearOverride(k)));
			void invalidate('settings:roles');
		} catch {
			toastError('Could not save permission change.');
			void invalidate('settings:roles');
		} finally {
			saving = null;
		}
	}

	// Record-level (if-owner) scope toggle for an owner-scopable module.
	async function toggleOwnerScope(rm: RoleModuleCaps, next: boolean) {
		if (!selected || !editable) return;
		saving = rm.module;
		rm.ifOwner = next;
		rm.overridden = true;
		try {
			await saveOverride(rm.module, rm.caps, next, rm.fieldLevel);
			void invalidate('settings:roles');
		} catch {
			toastError('Could not save scope change.');
			void invalidate('settings:roles');
		} finally {
			saving = null;
		}
	}

	// Field-level (sensitive fields) toggle: visible = SENSITIVE_FIELD_LEVEL, hidden = 0.
	async function toggleFieldVisible(rm: RoleModuleCaps, visible: boolean) {
		if (!selected || !editable) return;
		const level = visible ? SENSITIVE_FIELD_LEVEL : 0;
		saving = rm.module;
		rm.fieldLevel = level;
		rm.overridden = true;
		try {
			await saveOverride(rm.module, rm.caps, rm.ifOwner, level);
			void invalidate('settings:roles');
		} catch {
			toastError('Could not save field visibility.');
			void invalidate('settings:roles');
		} finally {
			saving = null;
		}
	}

	async function toggleChild(rm: RoleModuleCaps, sub: SubResourceCaps, action: string, next: boolean) {
		if (!selected || !editable) return;
		const caps = applyViewDep(sub.caps, action, next);
		saving = sub.key;
		sub.caps = caps;
		sub.overridden = true;
		try {
			await saveOverride(sub.key, caps);
			void invalidate('settings:roles');
		} catch {
			toastError('Could not save permission change.');
			void invalidate('settings:roles');
		} finally {
			saving = null;
		}
	}

	// Reset a whole module to defaults: clear its override and every child override.
	async function resetModule(rm: RoleModuleCaps) {
		if (!selected || !editable) return;
		saving = rm.module;
		try {
			await clearOverride(rm.module);
			await Promise.all(rm.subResources.filter((s) => s.overridden).map((s) => clearOverride(s.key)));
		} catch {
			toastError('Could not reset to default.');
		} finally {
			saving = null;
			void invalidate('settings:roles');
		}
	}

	async function resetSub(sub: SubResourceCaps) {
		if (!selected || !editable) return;
		saving = sub.key;
		try {
			await clearOverride(sub.key);
		} catch {
			toastError('Could not reset to default.');
		} finally {
			saving = null;
			void invalidate('settings:roles');
		}
	}

	// Set the DOM `indeterminate` property (not expressible as an attribute).
	function indeterminate(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return { update: (v: boolean) => (node.indeterminate = v) };
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
							{@const hasSubs = rm.subResources.length > 0}
							{@const isOpen = !!expanded[mod]}
							<tr class="border-b border-border/30 last:border-0">
								<td class="px-3 py-1.5 text-foreground">
									<span class="flex items-center gap-1.5">
										{#if hasSubs}
											<button
												type="button"
												class="rounded p-0.5 text-muted hover:bg-muted/20 hover:text-foreground"
												title={isOpen ? 'Collapse sections' : 'Expand sections'}
												onclick={() => (expanded[mod] = !isOpen)}
											>
												{#if isOpen}<ChevronDown class="h-3.5 w-3.5" />{:else}<ChevronRight class="h-3.5 w-3.5" />{/if}
											</button>
										{:else}
											<span class="inline-block w-[18px]"></span>
										{/if}
										{rm.label}
										{#if rm.overridden}
											<span class="h-1.5 w-1.5 rounded-full bg-accent" title="Customised for this organization"></span>
										{/if}
										{#if rm.ownerScopable}
											<button
												type="button"
												class="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors {rm.ifOwner
													? 'bg-accent/15 text-accent'
													: 'text-muted hover:bg-muted/20'}"
												title={rm.ifOwner
													? 'Restricted to records this role owns — click for full access'
													: 'Full access to all records — click to restrict to owned records'}
												disabled={!editable || saving === rm.module}
												onclick={() => toggleOwnerScope(rm, !rm.ifOwner)}
											>
												<UserCheck class="h-3 w-3" />
												{rm.ifOwner ? 'Own only' : 'All records'}
											</button>
										{/if}
										{#if rm.fieldScopable}
											{@const hidden = rm.fieldLevel < SENSITIVE_FIELD_LEVEL}
											<button
												type="button"
												class="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors {hidden
													? 'bg-amber-500/15 text-amber-500'
													: 'text-muted hover:bg-muted/20'}"
												title={hidden
													? 'Sensitive fields (PII / cost / margin) hidden — click to reveal'
													: 'Sensitive fields visible — click to hide PII / cost / margin'}
												disabled={!editable || saving === rm.module}
												onclick={() => toggleFieldVisible(rm, hidden)}
											>
												<EyeOff class="h-3 w-3" />
												{hidden ? 'Sensitive hidden' : 'Sensitive visible'}
											</button>
										{/if}
									</span>
								</td>
								{#each actions as a (a)}
									{@const st = parentState(rm, a)}
									<td class="px-2 py-1.5 text-center">
										<input
											type="checkbox"
											class="accent-accent disabled:opacity-40"
											checked={st.checked}
											use:indeterminate={st.indeterminate}
											disabled={!editable || saving === mod}
											onchange={(e) => toggleParent(rm, a, e.currentTarget.checked)}
										/>
									</td>
								{/each}
								<td class="px-1 py-1.5 text-center">
									{#if editable && (rm.overridden || rm.subResources.some((s) => s.overridden))}
										<button
											class="rounded p-1 text-muted hover:bg-muted/20 hover:text-foreground"
											title="Reset module to default"
											onclick={() => resetModule(rm)}
										>
											<RotateCcw class="h-3 w-3" />
										</button>
									{/if}
								</td>
							</tr>

							{#if hasSubs && isOpen}
								{#each rm.subResources as sub (sub.key)}
									<tr class="border-b border-border/20 bg-bg2/30 last:border-0">
										<td class="py-1.5 pl-9 pr-3 text-muted">
											<span class="flex items-center gap-1.5">
												<span class="text-[11px]">{sub.label}</span>
												{#if sub.overridden}
													<span class="h-1.5 w-1.5 rounded-full bg-accent" title="Set independently of the module"></span>
												{/if}
											</span>
										</td>
										{#each actions as a (a)}
											<td class="px-2 py-1.5 text-center">
												<input
													type="checkbox"
													class="accent-accent disabled:opacity-40"
													checked={sub.caps[a] ?? false}
													disabled={!editable || saving === sub.key}
													onchange={(e) => toggleChild(rm, sub, a, e.currentTarget.checked)}
												/>
											</td>
										{/each}
										<td class="px-1 py-1.5 text-center">
											{#if editable && sub.overridden}
												<button
													class="rounded p-1 text-muted hover:bg-muted/20 hover:text-foreground"
													title="Reset section to inherit the module"
													onclick={() => resetSub(sub)}
												>
													<RotateCcw class="h-3 w-3" />
												</button>
											{/if}
										</td>
									</tr>
								{/each}
							{/if}
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
			defaults — customise any of them for this organization. Expand a module to gate its sections
			independently; every action requires View. The agent inherits the signed-in user's permissions.
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
