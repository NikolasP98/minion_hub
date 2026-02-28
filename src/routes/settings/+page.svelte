<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { fade } from "svelte/transition";
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
    import {
        Check,
        Palette,
        SlidersHorizontal,
        Brain,
        Zap,
        Database,
        Radio,
        Plug,
        Monitor,
        MoreHorizontal,
        Users,
        Link2,
        Server,
        Globe,
    } from "lucide-svelte";
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

    // Section metadata for the page header
    const SECTION_META: Record<Section, { title: string; description: string; Icon: typeof Palette }> = {
        appearance:            { title: "Appearance",     description: "Themes, colors, logos, and visual preferences",          Icon: Palette           },
        "config-setup":        { title: "Setup",          description: "Core gateway configuration and initialization",          Icon: SlidersHorizontal },
        "config-ai":           { title: "AI",             description: "Language model and inference settings",                  Icon: Brain             },
        "config-automation":   { title: "Automation",     description: "Workflows, triggers, and automated tasks",               Icon: Zap               },
        "config-data":         { title: "Data",           description: "Storage, databases, and data management",                Icon: Database          },
        "config-comms":        { title: "Communications", description: "Messaging, notifications, and channels",                 Icon: Radio             },
        "config-integrations": { title: "Integrations",   description: "Third-party services and external connections",          Icon: Plug              },
        "config-system":       { title: "System",         description: "System-level settings and runtime configuration",        Icon: Monitor           },
        "config-other":        { title: "Other",          description: "Additional gateway settings",                            Icon: MoreHorizontal    },
        team:                  { title: "Team",           description: "Manage users and access control",                        Icon: Users             },
        bindings:              { title: "Bindings",       description: "Key bindings and action shortcuts",                      Icon: Link2             },
        gateways:              { title: "Gateways",       description: "Connected gateway servers",                              Icon: Server            },
    };

    // URL-persisted active section
    const activeSection = $derived(
        ((page.url.searchParams.get("s") ?? "appearance") as Section)
    );

    function selectSection(s: Section) {
        goto(`?s=${s}`, { replaceState: true, noScroll: true });
    }

    const isConfigSection = $derived(activeSection.startsWith("config-"));
    const activeMetaId = $derived(
        isConfigSection ? activeSection.slice("config-".length) : null,
    );

    const sectionMeta = $derived(SECTION_META[activeSection] ?? SECTION_META.appearance);
    const SectionIcon = $derived(sectionMeta.Icon);
    const sectionTitle = $derived(sectionMeta.title);
    const sectionDescription = $derived(sectionMeta.description);

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
            onselect={selectSection}
            {loadedMetaIds}
            hasOther={otherGroups.length > 0}
        />

        <main class="flex-1 min-h-0 overflow-hidden flex flex-col">
            <!-- Page-level section header -->
            <div class="shrink-0 px-6 md:px-10 py-4 border-b border-border flex items-center gap-3">
                <SectionIcon size={16} class="text-accent shrink-0" />
                <div>
                    <h1 class="text-sm font-semibold text-foreground">{sectionTitle}</h1>
                    <p class="text-[11px] text-muted-foreground">{sectionDescription}</p>
                </div>
            </div>

            <!-- Animated content area -->
            {#key activeSection}
                <div in:fade={{ duration: 80 }} class="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {#if activeSection === "appearance"}
                        <!-- Appearance: logo presets, theme, accent, pattern -->
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
                                                <!-- Accent stripe on the left -->
                                                <div
                                                    class="absolute left-0 top-0 bottom-0 w-1 rounded-l"
                                                    style="background:{preset.colors.accent}"
                                                ></div>

                                                <div class="pl-2">
                                                    <span class="text-sm font-medium text-card-foreground">{preset.name}</span>
                                                    {#if preset.style}
                                                        <span class="text-[10px] text-muted-foreground block mt-0.5">{m.settings_customTypography()}</span>
                                                    {/if}

                                                    <!-- 3 representative swatches -->
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

                                                    <!-- Active badge inside card -->
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
                                                {tag === "en" ? "English" : tag === "es" ? "Español" : tag}
                                            </option>
                                        {/each}
                                    </select>
                                </div>

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
                                    <div class="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
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
                </div>
            {/key}
        </main>
    </div>
</div>
