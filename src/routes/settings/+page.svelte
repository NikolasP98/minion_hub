<script lang="ts">
    import { conn } from "$lib/state/connection.svelte";
    import {
        configState,
        loadConfig,
        isDirty,
        groups,
    } from "$lib/state/config.svelte";
    import { hasConfiguredValues, countConfiguredKeys, META_GROUPS, getMetaGroupId } from "$lib/utils/config-schema";
    import { theme } from "$lib/state/theme.svelte";
    import { logoState } from "$lib/state/logo.svelte";
    import { locale } from "$lib/state/locale.svelte";
    import Topbar from "$lib/components/Topbar.svelte";
    import SettingsSidebar from "$lib/components/settings/SettingsSidebar.svelte";
    import PatternSettings from "$lib/components/settings/PatternSettings.svelte";
    import GatewaySettings from "$lib/components/settings/GatewaySettings.svelte";
    import MinionLogo from "$lib/components/MinionLogo.svelte";
    import ConfigSection from "$lib/components/config/ConfigSection.svelte";
    import ConfigSaveBar from "$lib/components/config/ConfigSaveBar.svelte";
    import TeamTab from "$lib/components/users/TeamTab.svelte";
    import BindingsTab from "$lib/components/users/BindingsTab.svelte";
    import { Check, Globe } from "lucide-svelte";
    import * as m from "$lib/paraglide/messages";
    import { SvelteSet } from "svelte/reactivity";

    type Section =
        | "appearance"
        | "config-setup"
        | "config-ai"
        | "config-automation"
        | "config-data"
        | "config-comms"
        | "config-integrations"
        | "config-system"
        | "config-other"
        | "team"
        | "bindings"
        | "gateways";

    let activeSection = $state<Section>("appearance");

    const isConfigSection = $derived(activeSection.startsWith("config-"));
    const activeMetaId = $derived(
        isConfigSection ? activeSection.slice("config-".length) : null,
    );

    // Load config when entering any config section or bindings
    $effect(() => {
        if (
            (isConfigSection || activeSection === "bindings") &&
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

    // Which meta-group IDs have at least one group in the loaded config
    const loadedMetaIds = $derived(
        [...new Set(groups.value.map((g) => getMetaGroupId(g.order)))]
    );

    // Groups whose order doesn't land in any defined meta-group range
    // (currently impossible with the fallback, but kept for safety)
    const otherGroups = $derived(
        groups.value.filter((g) => !META_GROUPS.some((m) => getMetaGroupId(g.order) === m.id))
    );

    // Groups visible in the active meta-group section, configured-first
    const activeGroups = $derived.by(() => {
        if (!activeMetaId) return [];
        const candidates =
            activeMetaId === "other"
                ? otherGroups
                : groups.value.filter((g) => getMetaGroupId(g.order) === activeMetaId);
        const configured: typeof candidates = [];
        const empty: typeof candidates = [];
        for (const g of candidates) {
            const val = configState.current[g.fields[0]?.key];
            if (hasConfiguredValues(val)) configured.push(g);
            else empty.push(g);
        }
        return [...configured, ...empty];
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
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">
    <Topbar />

    <div class="flex flex-1 min-h-0">
        <SettingsSidebar
            {activeSection}
            onselect={(s) => (activeSection = s)}
            {loadedMetaIds}
            hasOther={otherGroups.length > 0}
        />

        <main class="flex-1 min-h-0 overflow-hidden flex flex-col">
            {#if activeSection === "appearance"}
                <!-- Appearance: logo presets, theme, accent, pattern -->
                <div class="flex-1 overflow-y-auto p-6 md:p-10">
                    <div class="max-w-2xl mx-auto space-y-10">
                        <!-- Logo Presets -->
                        <section>
                            <h2
                                class="text-sm font-semibold text-foreground uppercase tracking-wider mb-4"
                            >
                                {m.settings_siteIdentity()}
                            </h2>
                            <div
                                class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3"
                            >
                                {#each logoState.presets as logoPreset (logoPreset.id)}
                                    <button
                                        type="button"
                                        class="group relative bg-card border rounded-xl p-4 cursor-pointer transition-all text-center
                                            {logoState.presetId === logoPreset.id
                                            ? 'border-accent ring-1 ring-accent/30'
                                            : 'border-border hover:border-muted-foreground'}"
                                        onclick={() =>
                                            logoState.setPreset(logoPreset.id)}
                                        title={logoPreset.description}
                                    >
                                        {#if logoState.presetId === logoPreset.id}
                                            <div
                                                class="absolute -top-2 -right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground shadow-sm"
                                            >
                                                <Check
                                                    size={10}
                                                    strokeWidth={3}
                                                />
                                                <span
                                                    class="text-[9px] font-semibold"
                                                    >{m.settings_active()}</span
                                                >
                                            </div>
                                        {/if}
                                        <div class="flex justify-center mb-3">
                                            <MinionLogo
                                                size="md"
                                                preset={logoPreset.id}
                                            />
                                        </div>
                                        <span
                                            class="text-xs font-medium text-card-foreground block"
                                            >{logoPreset.name}</span
                                        >
                                    </button>
                                {/each}
                            </div>
                            <p class="text-xs text-muted-foreground mt-3">
                                {m.settings_logoDescription()}
                            </p>
                        </section>

                        <!-- Theme Presets -->
                        <section>
                            <h2
                                class="text-sm font-semibold text-foreground uppercase tracking-wider mb-4"
                            >
                                {m.settings_theme()}
                            </h2>
                            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                {#each theme.presets as preset (preset.id)}
                                    <button
                                        type="button"
                                        class="group relative bg-card border rounded-lg p-4 cursor-pointer transition-all text-left
                                            {theme.presetId === preset.id
                                            ? 'border-accent ring-1 ring-accent/30'
                                            : 'border-border hover:border-muted-foreground'}"
                                        onclick={() =>
                                            theme.setPreset(preset.id)}
                                    >
                                        {#if theme.presetId === preset.id}
                                            <div
                                                class="absolute -top-2 -right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground shadow-sm"
                                            >
                                                <Check
                                                    size={10}
                                                    strokeWidth={3}
                                                />
                                                <span
                                                    class="text-[9px] font-semibold"
                                                    >{m.settings_active()}</span
                                                >
                                            </div>
                                        {/if}
                                        <span
                                            class="text-sm font-medium text-card-foreground"
                                            >{preset.name}</span
                                        >
                                        {#if preset.style}
                                            <span
                                                class="text-[10px] text-muted-foreground block mt-0.5"
                                                >{m.settings_customTypography()}</span
                                            >
                                        {/if}
                                        <div class="flex gap-1.5 mt-3">
                                            <div
                                                class="w-6 h-6 rounded"
                                                style="background:{preset
                                                    .colors
                                                    .bg}; border:1px solid {preset
                                                    .colors.border}"
                                            ></div>
                                            <div
                                                class="w-6 h-6 rounded"
                                                style="background:{preset
                                                    .colors
                                                    .bg2}; border:1px solid {preset
                                                    .colors.border}"
                                            ></div>
                                            <div
                                                class="w-6 h-6 rounded"
                                                style="background:{preset
                                                    .colors
                                                    .bg3}; border:1px solid {preset
                                                    .colors.border}"
                                            ></div>
                                            <div
                                                class="w-6 h-6 rounded"
                                                style="background:{preset
                                                    .colors
                                                    .border}; border:1px solid {preset
                                                    .colors.bg3}"
                                            ></div>
                                            <div
                                                class="w-6 h-6 rounded"
                                                style="background:{preset
                                                    .colors.accent}"
                                            ></div>
                                        </div>
                                    </button>
                                {/each}
                            </div>
                        </section>

                        <!-- Accent Color -->
                        <section>
                            <h2
                                class="text-sm font-semibold text-foreground uppercase tracking-wider mb-4"
                            >
                                {m.settings_accentColor()}
                            </h2>
                            <div class="flex flex-wrap gap-3">
                                {#each theme.accents as acc (acc.id)}
                                    <button
                                        type="button"
                                        class="rounded-full transition-all duration-150 cursor-pointer shrink-0
                                            {theme.accentId === acc.id
                                            ? 'ring-2 ring-offset-2 ring-offset-bg scale-110'
                                            : 'hover:scale-105'}"
                                        style="width:28px; height:28px; background:{acc.value}; --tw-ring-color:{acc.value};"
                                        title={acc.label}
                                        onclick={() =>
                                            theme.setAccent(acc.id)}
                                    >
                                        {#if theme.accentId === acc.id}
                                            <div
                                                class="w-full h-full flex items-center justify-center"
                                            >
                                                <Check
                                                    size={14}
                                                    strokeWidth={3}
                                                    class="text-white drop-shadow-sm"
                                                />
                                            </div>
                                        {/if}
                                        <span class="sr-only">{acc.label}</span>
                                    </button>
                                {/each}
                            </div>
                        </section>

                        <!-- Background Pattern -->
                        <PatternSettings />

                        <!-- Language -->
                        <section>
                            <h2
                                class="text-sm font-semibold text-foreground uppercase tracking-wider mb-4"
                            >
                                {m.settings_language()}
                            </h2>
                            <div class="flex gap-2">
                                {#each locale.available as tag (tag)}
                                    <button
                                        type="button"
                                        class="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm cursor-pointer transition-all
                                            {locale.current === tag
                                            ? 'border-accent bg-accent/8 text-foreground font-medium'
                                            : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-muted-foreground'}"
                                        onclick={() => locale.set(tag)}
                                    >
                                        <Globe
                                            size={14}
                                            class={locale.current === tag
                                                ? "text-accent"
                                                : "text-muted-foreground/60"}
                                        />
                                        {tag === "en"
                                            ? "English"
                                            : tag === "es"
                                              ? "Español"
                                              : tag}
                                        {#if locale.current === tag}
                                            <Check
                                                size={12}
                                                class="text-accent"
                                                strokeWidth={2.5}
                                            />
                                        {/if}
                                    </button>
                                {/each}
                            </div>
                        </section>
                    </div>
                </div>

            {:else if isConfigSection}
                <!-- Config meta-group section -->
                {#if !conn.connected}
                    <div class="flex-1 flex items-center justify-center">
                        <p class="text-sm text-muted-foreground">
                            {m.config_noServer()}
                        </p>
                    </div>
                {:else if configState.loading && !configState.loaded}
                    <div class="flex-1 flex items-center justify-center">
                        <div class="text-center">
                            <div
                                class="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3"
                            ></div>
                            <p class="text-muted-foreground text-xs">
                                {m.config_loading()}
                            </p>
                        </div>
                    </div>
                {:else if configState.loadError}
                    <div class="flex-1 flex items-center justify-center">
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
                    <div class="flex-1 flex flex-col min-h-0">
                        <div class="flex-1 overflow-y-auto px-6 py-5">
                            <div class="max-w-3xl mx-auto space-y-2.5">
                                {#if configState.version}
                                    <p class="text-[10px] text-muted-foreground mb-2">
                                        Gateway v{configState.version} &middot;
                                        {configState.configPath}
                                    </p>
                                {/if}
                                {#each activeGroups as group (group.id)}
                                    <ConfigSection
                                        {group}
                                        expanded={expandedIds.has(group.id)}
                                        ontoggle={() => toggleGroup(group.id)}
                                        configuredCount={configuredCountForGroup(group.id)}
                                    />
                                {/each}
                                {#if activeGroups.length === 0}
                                    <p class="text-muted-foreground text-sm">
                                        {m.config_noSections()}
                                    </p>
                                {/if}
                            </div>
                        </div>
                        {#if isDirty.value || configState.saving || configState.saveError}
                            <ConfigSaveBar />
                        {/if}
                    </div>
                {/if}

            {:else if activeSection === "team"}
                <TeamTab />

            {:else if activeSection === "bindings"}
                <BindingsTab />

            {:else if activeSection === "gateways"}
                <GatewaySettings />
            {/if}
        </main>
    </div>
</div>
