<script lang="ts">
	import { invalidate } from '$app/navigation';
	import {
		ShieldCheck,
		Users,
		RotateCcw,
		Lock,
		ChevronRight,
		ChevronDown,
		UserCheck,
		EyeOff,
		Eye,
		Copy,
		Trash2,
	} from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
	import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
	import { Button, Select, Tabs, Modal } from '$lib/components/ui';

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
	let expanded = $state<Record<string, boolean>>({}); // module key → granular ("Custom") panel open
	let activeTab = $state<string>('business'); // 'business' | 'admin'
	let onlyChanged = $state(true); // summary-first: show only customised modules by default

	// "Duplicate as custom role" dialog + delete state.
	let duplicateOpen = $state(false);
	let duplicateSource = $state<Role | null>(null);
	let duplicateName = $state('');
	let duplicating = $state(false);
	let deleting = $state<string | null>(null); // role key currently deleting

	function openDuplicate(role: Role) {
		duplicateSource = role;
		duplicateName = '';
		duplicateOpen = true;
	}

	async function submitDuplicate() {
		if (!duplicateSource || !duplicateName.trim()) return;
		duplicating = true;
		try {
			const res = await fetch('/api/roles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sourceRoleKey: duplicateSource.key, name: duplicateName.trim() }),
			});
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				toastError((d as { message?: string }).message ?? m.roles_errorDuplicate({ status: String(res.status) }));
				return;
			}
			const created = (await res.json()) as { key: string };
			duplicateOpen = false;
			selectedKey = created.key;
			toastSuccess(m.roles_duplicateSubmit());
			void invalidate('settings:roles');
		} finally {
			duplicating = false;
		}
	}

	async function deleteCustomRole(role: Role) {
		if (!confirm(m.roles_confirmDelete())) return;
		deleting = role.key;
		try {
			const res = await fetch(`/api/roles/${encodeURIComponent(role.key)}`, { method: 'DELETE' });
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				toastError((d as { message?: string }).message ?? m.roles_errorDelete({ status: String(res.status) }));
				return;
			}
			if (selectedKey === role.key) selectedKey = roles.find((r) => r.key !== role.key)?.key ?? '';
			void invalidate('settings:roles');
		} finally {
			deleting = null;
		}
	}

	const selected = $derived(roles.find((r) => r.key === selectedKey) ?? roles[0] ?? null);
	// Owner is intentionally not editable — it must always retain full access (no self-lockout).
	const editable = $derived(!!selected && selected.key !== 'owner');
	const EMPTY: ActionSet = { view: false, create: false, edit: false, delete: false, export: false, manage: false };

	// Named access levels collapse the 6 raw actions into one control. "Custom" is a
	// derived state (caps that don't match a named level) — selecting it just opens
	// the granular grid. Ladder: None ⊂ View ⊂ Edit ⊂ Full.
	const LEVEL_OPTIONS = [
		{ value: 'none', label: 'None' },
		{ value: 'view', label: 'View' },
		{ value: 'edit', label: 'Edit' },
		{ value: 'full', label: 'Full' },
		{ value: 'custom', label: 'Custom' },
	];
	// ponytail: assumes the standard view/create/edit/delete/export/manage action set;
	// tolerant of a module exposing a subset (compares only against `actions`).
	function levelCaps(level: string): ActionSet {
		const c = { ...EMPTY };
		if (level === 'none') return c;
		c.view = true;
		if (level === 'view') return c;
		c.create = true;
		c.edit = true;
		if (level === 'edit') return c;
		c.delete = true;
		c.export = true;
		c.manage = true; // full
		return c;
	}

	function capsFor(role: Role, mod: string): RoleModuleCaps | undefined {
		return role.modules.find((m) => m.module === mod);
	}

	// Resolve a module's current access level. Divergence across the module + its
	// sub-resources (or any non-ladder combo) reads as "custom".
	function effLevel(rm: RoleModuleCaps): string {
		const eff: ActionSet = {};
		for (const a of actions) {
			const st = parentState(rm, a);
			if (st.indeterminate) return 'custom';
			eff[a] = st.checked;
		}
		const on = (k: string) => !!eff[k];
		const onlyOf = (allow: string[]) => actions.every((a) => (allow.includes(a) ? true : !on(a)));
		if (actions.every((a) => !on(a))) return 'none';
		if (on('view') && onlyOf(['view'])) return 'view';
		if (on('view') && on('create') && on('edit') && onlyOf(['view', 'create', 'edit'])) return 'edit';
		if (actions.every((a) => on(a))) return 'full';
		return 'custom';
	}

	function moduleChanged(rm: RoleModuleCaps): boolean {
		return rm.overridden || rm.subResources.some((s) => s.overridden);
	}
	function changedCount(mods: string[]): number {
		if (!selected) return 0;
		return mods.reduce((n, mod) => {
			const rm = capsFor(selected, mod);
			return n + (rm && moduleChanged(rm) ? 1 : 0);
		}, 0);
	}
	// One-line plain-language summary of a group's access for the role header.
	function groupSummary(mods: string[]): string {
		if (!selected) return '';
		const levels = mods.map((mod) => {
			const rm = capsFor(selected, mod);
			return rm ? effLevel(rm) : 'none';
		});
		if (levels.every((l) => l === 'full')) return 'Full access';
		if (levels.every((l) => l === 'none')) return 'No access';
		if (levels.every((l) => l === 'view')) return 'View only';
		return 'Partial access';
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

	// Set a whole module to a named level. Cascades to children (their overrides
	// clear so they inherit). "custom" just opens the granular editor.
	async function setModuleLevel(rm: RoleModuleCaps, level: string) {
		if (!editable) return;
		if (level === 'custom') {
			expanded[rm.module] = true;
			return;
		}
		const caps = levelCaps(level);
		saving = rm.module;
		const dirtySubs = rm.subResources.filter((s) => s.overridden).map((s) => s.key);
		rm.caps = caps;
		rm.overridden = true;
		for (const s of rm.subResources) {
			s.caps = caps;
			s.overridden = false;
		}
		try {
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

	// Toggling a single action cascades to the parent module AND every child:
	// the parent gets the new caps, child overrides are cleared so they inherit it.
	async function toggleParent(rm: RoleModuleCaps, action: string, next: boolean) {
		if (!selected || !editable) return;
		const caps = applyViewDep(rm.caps, action, next);
		saving = rm.module;
		const dirtySubs = rm.subResources.filter((s) => s.overridden).map((s) => s.key);
		rm.caps = caps;
		rm.overridden = true;
		for (const s of rm.subResources) {
			s.caps = caps;
			s.overridden = false;
		}
		try {
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

	// Role-level "revert all to default": clear every override on the selected role.
	async function revertAll() {
		if (!selected || !editable) return;
		const mods = selected.modules.filter(moduleChanged);
		if (!mods.length) return;
		saving = '__all__';
		try {
			for (const rm of mods) {
				await clearOverride(rm.module);
				await Promise.all(rm.subResources.filter((s) => s.overridden).map((s) => clearOverride(s.key)));
			}
		} catch {
			toastError('Could not revert role to defaults.');
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

	const totalChanged = $derived(changedCount(businessModules) + changedCount(adminModules));
	const tabMods = $derived(activeTab === 'business' ? businessModules : adminModules);
	// Effective filter: "only changed" collapses to nothing when nothing changed, so
	// fall back to showing all for roles (e.g. Owner) with no overrides in this tab.
	const tabChanged = $derived(changedCount(tabMods));
	const showOnlyChanged = $derived(onlyChanged && tabChanged > 0);
	const visibleMods = $derived(
		selected
			? showOnlyChanged
				? tabMods.filter((mod) => {
						const rm = capsFor(selected, mod);
						return rm ? moduleChanged(rm) : false;
					})
				: tabMods
			: [],
	);
</script>

{#snippet actionGrid(rm: RoleModuleCaps, sub: SubResourceCaps | null)}
	<div class="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
		{#each actions as a (a)}
			{@const st = sub ? { checked: sub.caps[a] ?? false, indeterminate: false } : parentState(rm, a)}
			<label class="flex items-center gap-2 text-[length:var(--font-size-label)] capitalize text-foreground">
				<input
					type="checkbox"
					class="accent-accent disabled:opacity-40"
					checked={st.checked}
					use:indeterminate={st.indeterminate}
					disabled={!editable || saving === (sub ? sub.key : rm.module)}
					onchange={(e) =>
						sub
							? toggleChild(rm, sub, a, e.currentTarget.checked)
							: toggleParent(rm, a, e.currentTarget.checked)}
				/>
				{a}
			</label>
		{/each}
	</div>
{/snippet}

{#snippet moduleList(mods: string[])}
	<div class="overflow-hidden rounded-md border border-border bg-bg2/30">
		{#if mods.length === 0}
			<div class="px-3 py-5 text-center text-[length:var(--font-size-label)] text-muted">No modules.</div>
		{:else}
			<div class="divide-y divide-border/40">
				{#each mods as mod (mod)}
					{@const rm = selected ? capsFor(selected, mod) : undefined}
					{#if rm}
						{@const lvl = effLevel(rm)}
						{@const isOpen = !!expanded[mod]}
						{@const changed = moduleChanged(rm)}
						{@const sensitiveHidden = rm.fieldScopable && rm.fieldLevel < SENSITIVE_FIELD_LEVEL}
						<div>
							<div class="flex items-center gap-2 px-3 py-2.5">
								<Button variant="ghost" size="xs"
									type="button"
									class="rounded p-0.5 text-muted hover:bg-muted/20 hover:text-foreground"
									title={isOpen ? 'Hide advanced' : 'Advanced (granular actions, scope, sections)'}
									aria-expanded={isOpen}
									onclick={() => (expanded[mod] = !isOpen)}
								>
									{#if isOpen}<ChevronDown class="h-3.5 w-3.5" />{:else}<ChevronRight class="h-3.5 w-3.5" />{/if}
								</Button>

								<div class="min-w-0 flex-1">
									<span class="flex items-center gap-1.5">
										<span class="truncate text-[length:var(--font-size-body)] text-foreground">{rm.label}</span>
										{#if changed}
											<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Customised for this organization"></span>
										{/if}
									</span>
									<!-- read-only summary of advanced state; full controls live in the panel below -->
									{#if (rm.ownerScopable && rm.ifOwner) || sensitiveHidden || rm.subResources.length}
										<span class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[length:var(--font-size-telemetry)] text-muted">
											{#if rm.ownerScopable && rm.ifOwner}
												<span class="inline-flex items-center gap-1"><UserCheck class="h-3 w-3" /> Own records</span>
											{/if}
											{#if sensitiveHidden}
												<span class="inline-flex items-center gap-1"><EyeOff class="h-3 w-3" /> Sensitive hidden</span>
											{/if}
											{#if rm.subResources.length}
												<span>{rm.subResources.length} section{rm.subResources.length === 1 ? '' : 's'}</span>
											{/if}
										</span>
									{/if}
								</div>

								<Select
									size="sm"
									class="w-[104px] shrink-0"
									value={lvl}
									options={LEVEL_OPTIONS}
									disabled={!editable || saving === mod}
									aria-label={`${rm.label} access level`}
									onchange={(v) => setModuleLevel(rm, String(v))}
								/>

								{#if editable && changed}
									<Button variant="ghost" size="xs"
										type="button"
										class="shrink-0 rounded p-1 text-muted hover:bg-muted/20 hover:text-foreground"
										title="Reset module to default"
										disabled={saving === mod}
										onclick={() => resetModule(rm)}
									>
										<RotateCcw class="h-3 w-3" />
									</Button>
								{/if}
							</div>

							{#if isOpen}
								<div class="space-y-3 border-t border-border/30 bg-bg2/20 px-3 pb-3 pt-2.5 pl-9">
									{@render actionGrid(rm, null)}

									{#if rm.ownerScopable || rm.fieldScopable}
										<div class="flex flex-wrap gap-2">
											{#if rm.ownerScopable}
												<Button variant="ghost" size="xs"
													type="button"
													class="inline-flex items-center gap-1 rounded px-2 py-1 text-[length:var(--font-size-label)] transition-colors {rm.ifOwner
														? 'bg-accent/15 text-accent'
														: 'border border-border text-muted hover:bg-muted/20'}"
													title={rm.ifOwner
														? 'Restricted to records this role owns — click for full access'
														: 'Full access to all records — click to restrict to owned records'}
													disabled={!editable || saving === rm.module}
													onclick={() => toggleOwnerScope(rm, !rm.ifOwner)}
												>
													<UserCheck class="h-3 w-3" />
													{rm.ifOwner ? 'Own records only' : 'All records'}
												</Button>
											{/if}
											{#if rm.fieldScopable}
												{@const hidden = rm.fieldLevel < SENSITIVE_FIELD_LEVEL}
												<Button variant="ghost" size="xs"
													type="button"
													class="inline-flex items-center gap-1 rounded px-2 py-1 text-[length:var(--font-size-label)] transition-colors {hidden
														? 'bg-muted/20 text-muted'
														: 'border border-border text-muted hover:bg-muted/20'}"
													title={hidden
														? 'Sensitive fields (PII / cost / margin) hidden — click to reveal'
														: 'Sensitive fields visible — click to hide PII / cost / margin'}
													disabled={!editable || saving === rm.module}
													onclick={() => toggleFieldVisible(rm, hidden)}
												>
													{#if hidden}<EyeOff class="h-3 w-3" />{:else}<Eye class="h-3 w-3" />{/if}
													{hidden ? 'Sensitive hidden' : 'Sensitive visible'}
												</Button>
											{/if}
										</div>
									{/if}

									{#if rm.subResources.length}
										<div class="space-y-2.5 border-t border-border/30 pt-2.5">
											<span class="text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-wider text-muted">Sections</span>
											{#each rm.subResources as sub (sub.key)}
												<div>
													<span class="mb-1 flex items-center gap-1.5">
														<span class="text-[length:var(--font-size-label)] text-foreground">{sub.label}</span>
														{#if sub.overridden}
															<span class="h-1.5 w-1.5 rounded-full bg-accent" title="Set independently of the module"></span>
														{/if}
														{#if editable && sub.overridden}
															<Button variant="ghost" size="xs"
																type="button"
																class="rounded p-0.5 text-muted hover:bg-muted/20 hover:text-foreground"
																title="Reset section to inherit the module"
																onclick={() => resetSub(sub)}
															>
																<RotateCcw class="h-3 w-3" />
															</Button>
														{/if}
													</span>
													{@render actionGrid(rm, sub)}
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<section class="mx-auto min-h-0 max-w-5xl flex-1 overflow-y-auto px-4 pt-6">
	<header class="mb-5">
		<h2 class="text-base font-semibold text-foreground">Roles</h2>
		<p class="mt-0.5 text-[length:var(--font-size-label)] text-muted">
			What each role can see and do across the dashboard. Pick an access level per module — None,
			View, Edit, or Full — or open <span class="text-foreground">Advanced</span> for granular actions,
			record scope, and sections. Every action requires View. The agent inherits the signed-in user's
			permissions.
		</p>
	</header>

	<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-[260px_1fr]">
		<!-- Role list — full list on lg+, compact picker below (keeps the detail full-width on medium screens) -->
		<aside class="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
			<div class="border-b border-border/60 px-3 py-2.5">
				<span class="text-[length:var(--font-size-label)] font-semibold uppercase tracking-wider text-muted">All roles</span>
			</div>
			<ul class="divide-y divide-border/40">
				{#each roles as r (r.key)}
					{@const active = r.key === selectedKey}
					<li class="group relative">
						<Button variant="ghost" size="xs"
							type="button"
							class="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors {active
								? 'bg-accent/10'
								: 'hover:bg-muted/20'}"
							onclick={() => (selectedKey = r.key)}
						>
							<span class="h-1.5 w-1.5 rounded-full {active ? 'bg-accent' : 'bg-muted/50'}"></span>
							<span class="min-w-0 flex-1">
								<span class="flex items-center gap-1.5">
									<span class="truncate text-[length:var(--font-size-body)] font-medium text-foreground">{r.name}</span>
									{#if r.key === 'owner'}
										<Lock class="h-3 w-3 text-muted" />
									{:else if r.isSystem}
										<ShieldCheck class="h-3 w-3 text-muted" />
									{:else}
										<span class="rounded bg-accent/15 px-1 py-0.5 text-[length:var(--font-size-telemetry)] font-medium text-accent">
											{m.roles_customBadge()}
										</span>
									{/if}
								</span>
								{#if r.description}
									<span class="block truncate text-[length:var(--font-size-label)] text-muted">{r.description}</span>
								{/if}
							</span>
							<span class="inline-flex items-center gap-1 text-[length:var(--font-size-telemetry)] text-muted">
								<Users class="h-3 w-3" />
								{r.memberCount}
							</span>
						</Button>
						<span
							class="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
						>
							<Button variant="ghost" size="xs"
								type="button"
								class="rounded p-1 text-muted hover:bg-muted/20 hover:text-foreground"
								title={m.roles_duplicate()}
								onclick={() => openDuplicate(r)}
							>
								<Copy class="h-3 w-3" />
							</Button>
							{#if !r.isSystem}
								<Button variant="ghost" size="xs"
									type="button"
									class="rounded p-1 text-muted hover:bg-destructive/15 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
									title={r.memberCount > 0 ? m.roles_deleteInUse({ count: String(r.memberCount) }) : m.roles_deleteCustom()}
									disabled={r.memberCount > 0 || deleting === r.key}
									onclick={() => deleteCustomRole(r)}
								>
									<Trash2 class="h-3 w-3" />
								</Button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		</aside>

		<!-- Compact role picker (below lg) -->
		<div class="lg:hidden">
			<Select
				size="sm"
				value={selectedKey}
				options={roles.map((r) => ({ value: r.key, label: r.name }))}
				aria-label="Select role"
				onchange={(v) => (selectedKey = String(v))}
			/>
		</div>

		<!-- Detail -->
		<div class="min-w-0 rounded-lg border border-border bg-card">
			{#if selected}
				<div class="space-y-4 p-4 sm:p-5">
					<div class="flex flex-wrap items-center gap-2">
						<h3 class="text-[length:var(--font-size-section-title)] font-semibold text-foreground">{selected.name}</h3>
						{#if selected.key === 'owner'}
							<span class="inline-flex items-center gap-1 rounded bg-muted/20 px-1.5 py-0.5 text-[length:var(--font-size-telemetry)] text-muted">
								<Lock class="h-3 w-3" /> Full access (locked)
							</span>
						{:else if selected.isSystem}
							<span class="inline-flex items-center gap-1 rounded bg-muted/20 px-1.5 py-0.5 text-[length:var(--font-size-telemetry)] text-muted">
								<ShieldCheck class="h-3 w-3" /> Built-in
							</span>
						{/if}
						<span class="ml-auto inline-flex items-center gap-1 text-[length:var(--font-size-label)] text-muted">
							<Users class="h-3 w-3" />
							{selected.memberCount} member{selected.memberCount === 1 ? '' : 's'}
						</span>
					</div>

					{#if selected.description}
						<p class="-mt-2 text-[length:var(--font-size-label)] text-muted">{selected.description}</p>
					{/if}

					<!-- Plain-language summary + role-level revert -->
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--font-size-label)]">
						<span class="text-muted">Business data:</span>
						<span class="text-foreground">{groupSummary(businessModules)}</span>
						<span class="text-muted/50">·</span>
						<span class="text-muted">Platform &amp; admin:</span>
						<span class="text-foreground">{groupSummary(adminModules)}</span>
						{#if totalChanged > 0}
							<span class="text-muted/50">·</span>
							<span class="text-accent">{totalChanged} changed from default</span>
							{#if editable}
								<Button variant="ghost" size="xs"
									type="button"
									class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[length:var(--font-size-label)] text-muted hover:bg-muted/20 hover:text-foreground disabled:opacity-50"
									disabled={saving === '__all__'}
									onclick={revertAll}
								>
									<RotateCcw class="h-3 w-3" /> Revert all
								</Button>
							{/if}
						{/if}
					</div>

					<div class="flex flex-wrap items-center justify-between gap-2">
						<Tabs
							id="permission-group-tabs"
							size="sm"
							bind:value={activeTab}
							aria-label="Permission groups"
							tabs={[
								{ value: 'business', label: 'Business data', count: changedCount(businessModules) || undefined },
								{ value: 'admin', label: 'Platform & admin', count: changedCount(adminModules) || undefined },
							]}
						/>
						{#if tabChanged > 0}
							<Button variant="ghost" size="xs"
								type="button"
								class="text-[length:var(--font-size-label)] text-muted hover:text-foreground"
								onclick={() => (onlyChanged = !onlyChanged)}
							>
								{showOnlyChanged ? `Show all (${tabMods.length})` : 'Only changed'}
							</Button>
						{/if}
					</div>

					<div id={`permission-group-tabs-panel-${activeTab}`} role="tabpanel" aria-labelledby={`permission-group-tabs-tab-${activeTab}`}>
						{@render moduleList(visibleMods)}
					</div>
				</div>
			{:else}
				<div class="p-10 text-center text-[length:var(--font-size-label)] text-muted">No roles found.</div>
			{/if}
		</div>
	</div>
</section>

<Modal bind:open={duplicateOpen} title={m.roles_duplicateTitle()} size="sm">
	{#if duplicateSource}
		<div class="space-y-3">
			<p class="text-[length:var(--font-size-label)] text-muted">{m.roles_duplicateDescription({ source: duplicateSource.name })}</p>
			<label class="block space-y-1">
				<span class="text-[length:var(--font-size-label)] font-medium text-foreground">{m.roles_duplicateNameLabel()}</span>
				<input
					type="text"
					class="w-full rounded border border-border bg-bg2 px-2.5 py-1.5 text-[length:var(--font-size-body)] text-foreground"
					placeholder={m.roles_duplicateNamePlaceholder()}
					bind:value={duplicateName}
					onkeydown={(e) => e.key === 'Enter' && submitDuplicate()}
				/>
			</label>
		</div>
	{/if}
	{#snippet footer()}
		<Button variant="primary" size="sm"
			type="button"
			class="rounded px-3 py-1.5 text-[length:var(--font-size-label)] text-muted hover:bg-muted/20 hover:text-foreground"
			onclick={() => (duplicateOpen = false)}
		>
			{m.common_cancel()}
		</Button>
		<Button variant="ghost" size="xs"
			type="button"
			class="rounded bg-accent px-3 py-1.5 text-[length:var(--font-size-label)] font-medium text-accent-foreground disabled:opacity-50"
			disabled={!duplicateName.trim() || duplicating}
			onclick={submitDuplicate}
		>
			{duplicating ? m.roles_creating() : m.roles_duplicateSubmit()}
		</Button>
	{/snippet}
</Modal>
