<script lang="ts">
    import { page } from "$app/state";
    import { goto, beforeNavigate } from "$app/navigation";
    import { onMount } from "svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import {
        configState,
        loadConfig,
        isDirty,
        dirtyPaths,
        groups,
        save,
        discard,
        restartState,
    } from "$lib/state/config/config.svelte";
    import { countConfiguredKeys, getGroupsForTab, TABS } from "$lib/utils/config-schema";
    import { isAdmin } from "$lib/state/features/user.svelte";
    import SettingsSkeleton from "$lib/components/settings/SettingsSkeleton.svelte";
    import ConfigSection from "$lib/components/config/ConfigSection.svelte";
    import ConfigSaveBar from "$lib/components/config/ConfigSaveBar.svelte";
    import NavigationGuardModal from "$lib/components/config/NavigationGuardModal.svelte";
    import SettingsScrollspy from "$lib/components/settings/SettingsScrollspy.svelte";
    import BindingsTab from "$lib/components/users/BindingsTab.svelte";
    import ChannelsTab from "$lib/components/channels/ChannelsTab.svelte";
    import HostsTab from "$lib/components/settings/HostsTab.svelte";
    import * as m from "$lib/paraglide/messages";
    import { SvelteSet } from "svelte/reactivity";

    // ─── Non-admin redirect ───────────────────────────────────────────────
    // Gateway-config tabs (hosted on this legacy page) are admin-only.
    // Non-admin users get bounced to /settings/appearance.
    onMount(() => {
        if (!isAdmin.value) {
            goto('/settings/appearance', { replaceState: true });
        }
    });

    // ─── Navigation guard modal ───────────────────────────────────────────
    let guardModalOpen = $state(false);
    let pendingNavigation: (() => void) | null = null;

    beforeNavigate(({ cancel, to }) => {
        if (isDirty.value) {
            cancel();
            pendingNavigation = to ? () => goto(to.url.pathname + to.url.search) : null;
            guardModalOpen = true;
        }
    });

    async function handleGuardSave() {
        guardModalOpen = false;
        await save();
        pendingNavigation?.();
        pendingNavigation = null;
    }

    function handleGuardDiscard() {
        discard();
        guardModalOpen = false;
        pendingNavigation?.();
        pendingNavigation = null;
    }

    function handleGuardCancel() {
        guardModalOpen = false;
        pendingNavigation = null;
    }

    // ─── Disconnect banner + auto-save on reconnect ───────────────────────
    let pendingAutoSave = $state(false);

    $effect(() => {
        if (!conn.connected && isDirty.value) {
            pendingAutoSave = true;
        }
        if (conn.connected && pendingAutoSave) {
            pendingAutoSave = false;
            // Only auto-save if not in a restart cycle (restart handles its own reload)
            if (restartState.phase === 'idle') {
                save();
            }
        }
    });

    onMount(() => {
        function handleBeforeUnload(e: BeforeUnloadEvent) {
            if (isDirty.value) {
                e.preventDefault();
            }
        }
        function handleKeydown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                if (isDirty.value) save();
            }
        }
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('keydown', handleKeydown);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('keydown', handleKeydown);
        };
    });

    // Gateway-config tabs hosted on this page (hosts + ai/agents/comms/security/system).
    // appearance + backups are now their own routes; they no longer live here.
    const GATEWAY_TAB_IDS = new Set(['hosts', 'ai', 'agents', 'comms', 'security', 'system']);
    const gatewayTabsList = TABS.filter((t) => GATEWAY_TAB_IDS.has(t.id));

    // URL-persisted active tab
    const activeTab = $derived(
        page.url.searchParams.get("s") ?? "hosts"
    );

    const isHostsTab = $derived(activeTab === 'hosts');
    const isConfigTab = $derived(
        activeTab !== 'hosts' && GATEWAY_TAB_IDS.has(activeTab),
    );

    // Load config when entering any non-hosts gateway tab while connected
    $effect(() => {
        if (
            isConfigTab &&
            conn.connected &&
            !configState.loaded &&
            !configState.loading
        ) {
            loadConfig();
        }
        if (!conn.connected && configState.loading) {
            configState.loading = false;
        }
    });

    let expandedIds = new SvelteSet<string>();


    function toggleGroup(groupId: string) {
        if (expandedIds.has(groupId)) expandedIds.delete(groupId);
        else expandedIds.add(groupId);
    }

    function configuredCountForGroup(groupId: string): number {
        const g = groups.value.find((x) => x.id === groupId);
        if (!g) return 0;
        const val = configState.current[g.fields[0]?.key];
        return countConfiguredKeys(val);
    }

    // Get groups for each tab (precomputed for all tabs)
    function getTabGroups(tabId: string) {
        return getGroupsForTab(tabId, groups.value);
    }

    // Scroll container refs for each gateway tab (for scrollspy)
    let scrollContainers: Record<string, HTMLElement | null> = $state({});

    // Compute dirty group IDs: a group is dirty if any of its fields' keys are in dirtyPaths
    const dirtyGroupIds = $derived.by(() => {
        const dirty = dirtyPaths.value;
        const result = new Set<string>();
        for (const g of groups.value) {
            if (g.fields.some((f) => dirty.has(f.key))) {
                result.add(g.id);
            }
        }
        return result;
    });
</script>

<div class="flex-1 min-h-0 relative">
    <!-- Hosts tab panel (hub-managed but still hosted here for now) -->
    <div
        class="tab-panel absolute inset-0 flex flex-col overflow-hidden"
        style:visibility={isHostsTab ? 'visible' : 'hidden'}
        style:z-index={isHostsTab ? 1 : 0}
        role="tabpanel"
    >
        <div class="flex-1 overflow-y-auto p-6 md:p-10">
            <div class="max-w-2xl mx-auto">
                <HostsTab />
            </div>
        </div>
    </div>

    <!-- Gateway config tab panels (AI, Agents, Comms, Security, System) -->
    {#each gatewayTabsList.filter((t) => t.id !== 'hosts') as tab (tab.id)}
        {@const isActive = activeTab === tab.id}
        <div
            class="tab-panel absolute inset-0 flex flex-col overflow-hidden"
            style:visibility={isActive ? 'visible' : 'hidden'}
            style:z-index={isActive ? 1 : 0}
            role="tabpanel"
        >
            <!-- Disconnect + dirty banner -->
            {#if !conn.connected && isDirty.value}
                <div class="mx-6 mt-4 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-center gap-3 shrink-0">
                    <span class="text-amber-400 text-xs font-medium">{m.config_disconnected()}</span>
                    <span class="text-muted-foreground text-xs flex-1">
                        {m.config_disconnectedAutoSave()}
                    </span>
                </div>
            {/if}

            {#if !conn.connected}
                <div class="flex-1 flex items-center justify-center h-full min-h-[300px]">
                    <div class="text-center">
                        <p class="text-sm text-muted-foreground">
                            {m.config_noServer()}
                        </p>
                        <p class="text-xs text-muted-foreground/60 mt-1">
                            {m.config_connectHint()}
                        </p>
                    </div>
                </div>
            {:else if configState.loading && !configState.loaded}
                <SettingsSkeleton />
            {:else if configState.loadError}
                <div class="flex-1 flex items-center justify-center h-full min-h-[300px]">
                    <div class="text-center max-w-sm">
                        <p class="text-destructive text-sm mb-2">
                            {m.config_error()}
                        </p>
                        <p class="text-muted-foreground text-xs mb-4">
                            {configState.loadError}
                        </p>
                        <button
                            class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-4"
                            onclick={() => loadConfig()}
                        >
                            {m.common_retry()}
                        </button>
                    </div>
                </div>
            {:else}
                <div class="flex-1 flex flex-col min-h-0 overflow-y-auto relative" bind:this={scrollContainers[tab.id]}>
                    <div class="px-6 py-5">
                        <div class="max-w-3xl mx-auto space-y-2.5">
                            {#if configState.version && tab.id === 'system'}
                                <p class="text-[10px] text-muted-foreground mb-2">
                                    Gateway v{configState.version} &middot;
                                    {configState.configPath}
                                </p>
                            {/if}

                            {#each getTabGroups(tab.id) as group (group.id)}
                                <ConfigSection
                                    {group}
                                    expanded={expandedIds.has(group.id)}
                                    ontoggle={() => toggleGroup(group.id)}
                                    configuredCount={configuredCountForGroup(group.id)}
                                />
                            {/each}

                            {#if getTabGroups(tab.id).length === 0 && configState.loaded && tab.id !== 'security' && tab.id !== 'agents' && tab.id !== 'comms'}
                                <div class="text-center py-12">
                                    <p class="text-muted-foreground text-sm">
                                        {m.config_noTabSettings({ label: tab.label })}
                                    </p>
                                    <p class="text-xs text-muted-foreground/60 mt-1">
                                        {m.config_noTabSettingsHint()}
                                    </p>
                                </div>
                            {/if}

                            <!-- Integrated sections per tab -->
                            {#if tab.id === 'security'}
                                <!-- Team + Roles management has moved to dedicated routes -->
                                <div class="mt-6 bg-card border border-border rounded-lg px-5 py-4 text-xs text-muted-foreground">
                                    <p>
                                        Manage team members at <a href="/settings/team" class="text-accent hover:underline">Settings → Team</a>
                                        and custom roles at <a href="/settings/roles" class="text-accent hover:underline">Settings → Roles</a>.
                                    </p>
                                </div>
                            {/if}
                            {#if tab.id === 'agents'}
                                <div class="mt-6">
                                    <BindingsTab />
                                </div>
                            {/if}
                            {#if tab.id === 'comms'}
                                <div class="mt-6">
                                    <ChannelsTab />
                                </div>
                            {/if}
                        </div>
                    </div>
                    {#if isActive}
                        <SettingsScrollspy
                            groups={getTabGroups(tab.id)}
                            {dirtyGroupIds}
                            scrollContainer={scrollContainers[tab.id] ?? null}
                        />
                    {/if}
                </div>
            {/if}
        </div>
    {/each}
</div>

<!-- ConfigSaveBar spans all tabs -->
{#if isDirty.value || configState.saving || configState.saveError}
    <ConfigSaveBar />
{/if}

<NavigationGuardModal
    bind:open={guardModalOpen}
    onsave={handleGuardSave}
    ondiscard={handleGuardDiscard}
    oncancel={handleGuardCancel}
/>

