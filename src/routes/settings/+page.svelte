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
        restartState,
    } from "$lib/state/config/config.svelte";
    import { hasConfiguredValues, countConfiguredKeys, getGroupsForTab, TABS } from "$lib/utils/config-schema";
    import { theme } from "$lib/state/ui/theme.svelte";
    import { logoState } from "$lib/state/ui/logo.svelte";
    import { locale } from "$lib/state/ui/locale.svelte";
    import Topbar from "$lib/components/Topbar.svelte";
    import SettingsTabBar from "$lib/components/settings/SettingsTabBar.svelte";
    import SettingsSkeleton from "$lib/components/settings/SettingsSkeleton.svelte";
    import PatternSettings from "$lib/components/settings/PatternSettings.svelte";
    import SparklineStyleSettings from "$lib/components/settings/SparklineStyleSettings.svelte";
    import GatewaySettings from "$lib/components/settings/GatewaySettings.svelte";
    import MinionLogo from "$lib/components/MinionLogo.svelte";
    import ConfigSection from "$lib/components/config/ConfigSection.svelte";
    import ConfigSaveBar from "$lib/components/config/ConfigSaveBar.svelte";
    import SettingsScrollspy from "$lib/components/settings/SettingsScrollspy.svelte";
    import TeamTab from "$lib/components/users/TeamTab.svelte";
    import BindingsTab from "$lib/components/users/BindingsTab.svelte";
    import {
        Check,
        Globe,
    } from "lucide-svelte";
    import * as m from "$lib/paraglide/messages";
    import { SvelteSet } from "svelte/reactivity";

    // ─── Navigation guards & keyboard shortcut ────────────────────────────
    beforeNavigate(({ cancel }) => {
        if (isDirty.value) {
            if (!confirm('You have unsaved changes. Leave anyway?')) cancel();
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

    // Gateway config tab IDs (all tabs except appearance)
    const GATEWAY_TAB_IDS = new Set(TABS.filter((t) => t.id !== 'appearance').map((t) => t.id));

    // URL-persisted active tab
    const activeTab = $derived(
        page.url.searchParams.get("s") ?? "appearance"
    );

    function selectTab(id: string) {
        goto(`?s=${id}`, { replaceState: true, noScroll: true });
    }

    const isGatewayTab = $derived(GATEWAY_TAB_IDS.has(activeTab));

    // Load config when entering any gateway config tab while connected
    $effect(() => {
        if (
            isGatewayTab &&
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

    // Auto-expand configured groups on initial load
    $effect(() => {
        if (configState.loaded && expandedIds.size === 0) {
            for (const g of groups.value) {
                if (hasConfiguredValues(configState.current[g.fields[0]?.key])) {
                    expandedIds.add(g.id);
                }
            }
            if (expandedIds.size === 0 && groups.value.length > 0) {
                expandedIds.add(groups.value[0].id);
            }
        }
    });

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

<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">
    <Topbar />
    <SettingsTabBar {activeTab} onselect={selectTab} />

    <div class="flex-1 min-h-0 relative">
        <!-- Appearance tab panel -->
        <div
            class="tab-panel absolute inset-0 overflow-y-auto"
            style:visibility={activeTab === 'appearance' ? 'visible' : 'hidden'}
            style:position={activeTab === 'appearance' ? 'relative' : 'absolute'}
            style:height={activeTab === 'appearance' ? 'auto' : '0'}
            style:overflow={activeTab === 'appearance' ? 'auto' : 'hidden'}
            role="tabpanel"
        >
            <div class="flex-1 overflow-y-auto p-6 md:p-10">
                <div class="max-w-2xl mx-auto space-y-4">

                    <!-- Logo Presets -->
                    <div class="bg-card border border-border rounded-lg px-5 py-4">
                        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                            {m.settings_siteIdentity()}
                        </h2>
                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                            {#each logoState.presets as logoPreset (logoPreset.id)}
                                <button
                                    type="button"
                                    class="group relative bg-bg border rounded-xl p-4 cursor-pointer transition-all text-center
                                        {logoState.presetId === logoPreset.id
                                        ? 'border-accent ring-1 ring-accent/30'
                                        : 'border-border hover:border-muted-foreground'}"
                                    onclick={() => logoState.setPreset(logoPreset.id)}
                                    title={logoPreset.description}
                                >
                                    {#if logoState.presetId === logoPreset.id}
                                        <div class="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground shadow-sm">
                                            <Check size={10} strokeWidth={3} />
                                            <span class="text-[9px] font-semibold">{m.settings_active()}</span>
                                        </div>
                                    {/if}
                                    <div class="flex justify-center mb-3">
                                        <MinionLogo size="md" preset={logoPreset.id} />
                                    </div>
                                    <span class="text-xs font-medium text-card-foreground block">{logoPreset.name}</span>
                                </button>
                            {/each}
                        </div>
                        <p class="text-xs text-muted-foreground mt-3">
                            {m.settings_logoDescription()}
                        </p>
                    </div>

                    <!-- Theme Presets -->
                    <div class="bg-card border border-border rounded-lg px-5 py-4">
                        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                            {m.settings_theme()}
                        </h2>
                        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {#each theme.presets as preset (preset.id)}
                                <button
                                    type="button"
                                    class="group relative bg-bg border rounded-lg p-4 cursor-pointer transition-all text-left overflow-hidden
                                        {theme.presetId === preset.id
                                        ? 'border-accent ring-1 ring-accent/30'
                                        : 'border-border hover:border-muted-foreground'}"
                                    onclick={() => theme.setPreset(preset.id)}
                                >
                                    <div
                                        class="absolute left-0 top-0 bottom-0 w-1 rounded-l"
                                        style="background:{preset.colors.accent}"
                                    ></div>
                                    <div class="pl-2">
                                        <span class="text-sm font-medium text-card-foreground">{preset.name}</span>
                                        {#if preset.style}
                                            <span class="text-[10px] text-muted-foreground block mt-0.5">{m.settings_customTypography()}</span>
                                        {/if}
                                        <div class="flex gap-2 mt-3">
                                            <div
                                                class="w-8 h-8 rounded"
                                                style="background:{preset.colors.bg}; border:1px solid {preset.colors.border}"
                                                title="Background"
                                            ></div>
                                            <div
                                                class="w-8 h-8 rounded"
                                                style="background:{preset.colors.bg2}; border:1px solid {preset.colors.border}"
                                                title="Card"
                                            ></div>
                                            <div
                                                class="w-8 h-8 rounded"
                                                style="background:{preset.colors.accent}"
                                                title="Accent"
                                            ></div>
                                        </div>
                                        {#if theme.presetId === preset.id}
                                            <div class="flex items-center gap-0.5 mt-2 w-fit px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground shadow-sm">
                                                <Check size={10} strokeWidth={3} />
                                                <span class="text-[9px] font-semibold">{m.settings_active()}</span>
                                            </div>
                                        {/if}
                                    </div>
                                </button>
                            {/each}
                        </div>
                    </div>

                    <!-- Accent Color -->
                    <div class="bg-card border border-border rounded-lg px-5 py-4">
                        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                            {m.settings_accentColor()}
                        </h2>
                        <div class="grid grid-cols-5 gap-y-3 gap-x-4 w-fit">
                            {#each theme.accents as acc (acc.id)}
                                <div class="flex flex-col items-center gap-1">
                                    <button
                                        type="button"
                                        class="rounded-full transition-all duration-150 cursor-pointer shrink-0 flex items-center justify-center
                                            {theme.accentId === acc.id
                                            ? 'ring-2 ring-offset-2 ring-offset-bg scale-110'
                                            : 'hover:scale-105'}"
                                        style="width:28px; height:28px; background:{acc.value}; --tw-ring-color:{acc.value};"
                                        title={acc.label}
                                        onclick={() => theme.setAccent(acc.id)}
                                    >
                                        {#if theme.accentId === acc.id}
                                            <Check size={14} strokeWidth={3} class="text-white drop-shadow-sm" />
                                        {/if}
                                        <span class="sr-only">{acc.label}</span>
                                    </button>
                                    <span class="text-[9px] text-muted-foreground leading-none">{acc.label}</span>
                                </div>
                            {/each}
                        </div>
                    </div>

                    <!-- Background Pattern -->
                    <div class="bg-card border border-border rounded-lg px-5 py-4">
                        <PatternSettings />
                    </div>

                    <!-- Sparkline Style -->
                    <div class="bg-card border border-border rounded-lg px-5 py-4">
                        <SparklineStyleSettings />
                    </div>

                    <!-- Language -->
                    <div class="bg-card border border-border rounded-lg px-5 py-4">
                        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                            <span class="flex items-center gap-2">
                                <Globe size={13} class="text-muted-foreground/70" />
                                {m.settings_language()}
                            </span>
                        </h2>
                        <select
                            class="bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm cursor-pointer transition-colors hover:border-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                            value={locale.current}
                            onchange={(e) => locale.set(e.currentTarget.value as Parameters<typeof locale.set>[0])}
                        >
                            {#each locale.available as tag (tag)}
                                <option value={tag}>
                                    {tag === "en" ? "English" : tag === "es" ? "Espanol" : tag}
                                </option>
                            {/each}
                        </select>
                    </div>

                </div>
            </div>
        </div>

        <!-- Gateway config tab panels (AI, Agents, Comms, Security, System) -->
        {#each TABS.filter((t) => t.id !== 'appearance') as tab (tab.id)}
            {@const isActive = activeTab === tab.id}
            <div
                class="tab-panel absolute inset-0"
                style:visibility={isActive ? 'visible' : 'hidden'}
                style:position={isActive ? 'relative' : 'absolute'}
                style:height={isActive ? 'auto' : '0'}
                style:overflow={isActive ? 'visible' : 'hidden'}
                role="tabpanel"
            >
                {#if !conn.connected}
                    <div class="flex-1 flex items-center justify-center h-full min-h-[300px]">
                        <div class="text-center">
                            <p class="text-sm text-muted-foreground">
                                {m.config_noServer()}
                            </p>
                            <p class="text-xs text-muted-foreground/60 mt-1">
                                Connect via the System tab or select a host from the topbar
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

                                {#if getTabGroups(tab.id).length === 0 && configState.loaded}
                                    <p class="text-muted-foreground text-sm py-4">
                                        {m.config_noSections()}
                                    </p>
                                {/if}

                                <!-- Integrated sections per tab -->
                                {#if tab.id === 'security'}
                                    <div class="mt-6">
                                        <TeamTab />
                                    </div>
                                {/if}
                                {#if tab.id === 'agents'}
                                    <div class="mt-6">
                                        <BindingsTab />
                                    </div>
                                {/if}
                                {#if tab.id === 'system'}
                                    <div class="mt-6">
                                        <GatewaySettings />
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
    {#if isDirty.value || configState.saving || configState.saveError || restartState.phase !== 'idle'}
        <ConfigSaveBar />
    {/if}
</div>
