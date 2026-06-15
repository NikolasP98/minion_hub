<script lang="ts">
    import { ui } from "$lib/state/ui/ui.svelte";
    import {
        configState,
        loadConfig,
        isDirty,
        save,
        discard,
        setField,
    } from "$lib/state/config/config.svelte";
    import { agentSkillsState } from "$lib/state/agents/agent-skills.svelte";
    import { gw } from "$lib/state/gateway/gateway-data.svelte";
    import { deepGet } from "$lib/utils/config-schema";
    import {
        buildGroupedFields,
        type ResolvedGroup,
        type ResolvedField,
        type AgentStructure,
    } from "$lib/utils/agent-settings-schema";
    import ConfigField from "../config/ConfigField.svelte";
    import AgentSkillsPanel from "./AgentSkillsPanel.svelte";
    import AgentSettingsNav from "./AgentSettingsNav.svelte";
    import * as m from "$lib/paraglide/messages";
    import { agentDisplayName } from "$lib/utils/agent-display";
    import { UserRound, BrainCircuit, Zap } from "lucide-svelte";

    let { agentId }: { agentId: string } = $props();

    // ─── Archetype-driven UI ─────────────────────────────────────────────
    // The archetype picker tailors which setting groups are shown so each kind
    // of agent surfaces only its relevant configuration.
    type ArchetypeId = "copilot" | "brain" | "autonomous";
    const ARCHETYPES: ReadonlyArray<{
        id: ArchetypeId;
        label: () => string;
        desc: () => string;
        icon: typeof UserRound;
    }> = [
        { id: "copilot", label: () => m.nav_copilots(), desc: () => m.archetype_copilotDesc(), icon: UserRound },
        { id: "brain", label: () => m.nav_brains(), desc: () => m.archetype_brainDesc(), icon: BrainCircuit },
        { id: "autonomous", label: () => m.nav_autonomous(), desc: () => m.archetype_autonomousDesc(), icon: Zap },
    ];
    // Groups shown for every archetype; the rest are gated per archetype below.
    const ALWAYS_GROUPS = new Set(["identity", "model", "behavior", "advanced"]);
    const ARCHETYPE_GROUPS: Record<ArchetypeId, Set<string>> = {
        copilot: new Set(["workspace", "tools"]),
        brain: new Set(["memory", "context", "compaction"]),
        autonomous: new Set(["session", "sandbox"]),
    };

    // ─── Active section state ────────────────────────────────────────────
    let activeSection = $state('identity');
    let searchQuery = $state('');

    // ─── Auto-load config on mount ───────────────────────────────────────
    $effect(() => {
        if (!configState.loaded && !configState.loading) {
            loadConfig();
        }
    });

    // ─── Build grouped fields (re-derives when config changes) ─────────
    const resolved = $derived(
        configState.loaded
            ? buildGroupedFields(
                  configState.current,
                  configState.schema,
                  agentId,
              )
            : null,
    );

    const resolvedGroups: ResolvedGroup[] = $derived(resolved?.groups ?? []);
    const structure: AgentStructure | null = $derived(
        resolved?.structure ?? null,
    );
    const isListStructure = $derived(structure?.type === "list");

    // ─── Agent display name for title ─────────────────────────────────────
    const agentData = $derived(gw.agents.find((a) => a.id === agentId));
    const displayName = $derived(
        agentDisplayName(agentData) || agentId.slice(0, 16) + (agentId.length > 16 ? '…' : ''),
    );

    // ─── When this agent's `default` becomes true, clear all other agents' defaults
    $effect(() => {
        if (!structure || structure.type !== "list") return;
        const myDefault = deepGet(
            configState.current,
            `${structure.pathPrefix}.default`,
        );
        if (myDefault !== true) return;

        const list = (configState.current?.agents as Record<string, unknown>)
            ?.list;
        if (!Array.isArray(list)) return;

        const myIndex = (structure as { listIndex: number }).listIndex;
        list.forEach((_agent: unknown, idx: number) => {
            if (idx === myIndex) return;
            const path = `agents.list.${idx}.default`;
            if (deepGet(configState.current, path) === true) {
                setField(path, false);
            }
        });
    });

    // ─── Current archetype (from this agent's config) + its config path ──
    const archetypeField = $derived(
        resolvedGroups.flatMap((g) => g.fields).find((f) => f.key === "archetype") ?? null,
    );
    const archetypePath = $derived(archetypeField?.path ?? null);
    const currentArchetype = $derived(
        (typeof archetypeField?.value === "string"
            ? archetypeField.value
            : "copilot") as ArchetypeId,
    );
    function pickArchetype(id: ArchetypeId) {
        if (archetypePath) setField(archetypePath, id);
    }

    // ─── Visibility: always-on groups + the current archetype's groups, plus
    // any group the user has explicitly overridden (so nothing configured is
    // ever hidden when switching archetype).
    const visibleGroups = $derived(
        resolvedGroups.filter((g) => {
            const id = g.group.id;
            if (ALWAYS_GROUPS.has(id)) return true;
            if (ARCHETYPE_GROUPS[currentArchetype]?.has(id)) return true;
            return g.fields.some((f) => f.isOverridden);
        }),
    );

    // If the active section gets hidden by an archetype switch, fall back to Identity.
    $effect(() => {
        if (!configState.loaded) return;
        if (activeSection === "skills" || activeSection === "bindings") return;
        if (!visibleGroups.some((g) => g.group.id === activeSection)) {
            activeSection = "identity";
        }
    });

    // ─── Active group (the group currently shown in the right column) ──
    const activeGroup = $derived(
        visibleGroups.find((g) => g.group.id === activeSection) ?? null,
    );

    // ─── Search filtering for right column ──────────────────────────────
    const searchFilteredFields = $derived.by(() => {
        // The archetype field is rendered as the dedicated picker bar, not as a
        // plain dropdown in the Identity group.
        const fields = (activeGroup?.fields ?? []).filter((f) => f.key !== "archetype");
        if (!searchQuery.trim()) return fields;
        const q = searchQuery.toLowerCase();
        return fields.filter(
            (f) =>
                (f.hint?.label ?? f.key).toLowerCase().includes(q) ||
                (f.hint?.help ?? '').toLowerCase().includes(q) ||
                f.key.toLowerCase().includes(q),
        );
    });

    // ─── Bindings that reference this agent ────────────────────────────
    const bindingEntries: [string, unknown][] = $derived.by(() => {
        const bindings = configState.current.bindings;
        if (
            !bindings ||
            typeof bindings !== "object" ||
            Array.isArray(bindings)
        )
            return [];

        const result: [string, unknown][] = [];
        for (const [key, val] of Object.entries(
            bindings as Record<string, unknown>,
        )) {
            if (typeof val === "string" && val.includes(agentId)) {
                result.push([key, val]);
            } else if (val && typeof val === "object") {
                const obj = val as Record<string, unknown>;
                const refsAgent = Object.values(obj).some(
                    (v) => typeof v === "string" && v.includes(agentId),
                );
                if (refsAgent) result.push([key, val]);
            }
        }
        return result;
    });

    const bindingsSchema = $derived(
        configState.schema?.properties?.bindings ?? null,
    );

    // ─── Reset a field (remove override, fall back to default) ─────────
    function resetField(field: ResolvedField) {
        setField(field.path, undefined);
    }

    // ─── Helpers ───────────────────────────────────────────────────────
    function close() {
        ui.agentSettingsOpen = false;
    }

    function handleBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget) close();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") close();
    }

    const hasContent = $derived(
        visibleGroups.length > 0 || bindingEntries.length > 0,
    );

    function countOverrides(fields: ResolvedField[]): number {
        return fields.filter((f) => f.isOverridden).length;
    }

    // ─── Enabled skill counts for nav ──────────────────────────────────
    const enabledSkillCount = $derived(
        agentSkillsState.skills.filter((s) => s.agentEnabled && !s.disabled).length,
    );

    /** Copy agent ID to clipboard */
    let idCopied = $state(false);
    function copyAgentId() {
        navigator.clipboard.writeText(agentId);
        idCopied = true;
        setTimeout(() => (idCopied = false), 1500);
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<div
    class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] cursor-pointer"
    role="button"
    tabindex="-1"
    aria-label={m.common_close()}
    onclick={handleBackdropClick}
    onkeydown={(e) => e.key === "Escape" && close()}
>
    <!-- Panel — two-column drawer -->
    <div
        class="absolute top-0 right-0 h-full w-[680px] max-w-full bg-bg2 border-l border-border flex flex-col shadow-2xl"
        role="dialog"
        tabindex="-1"
        aria-label="Agent settings for {agentId}"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
    >
        <!-- Header -->
        <div
            class="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border"
        >
            {#if agentData?.emoji}
                <span class="text-base">{agentData.emoji}</span>
            {/if}
            <div class="flex-1 min-w-0">
                <span class="text-sm font-bold text-foreground truncate block">
                    {m.settings_configureAgent({ name: displayName })}
                </span>
            </div>
            <button
                type="button"
                class="bg-transparent border-none text-muted-foreground cursor-pointer text-lg leading-none p-1 transition-colors hover:text-foreground"
                onclick={close}
                aria-label={m.common_close()}
            >
                &times;
            </button>
        </div>

        <!-- Body -->
        {#if configState.loading && !configState.loaded}
            <div class="flex-1 flex items-center justify-center">
                <div class="text-center">
                    <div
                        class="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3"
                    ></div>
                    <p class="text-muted-foreground text-xs">
                        {m.config_loading()}
                    </p>
                </div>
            </div>
        {:else if configState.loadError}
            <div class="flex-1 flex items-center justify-center px-4">
                <div class="text-center">
                    <p class="text-destructive text-xs mb-2">
                        {m.config_error()}
                    </p>
                    <p class="text-muted-foreground text-[11px] mb-3">
                        {configState.loadError}
                    </p>
                    <button
                        type="button"
                        class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-1.25 px-3"
                        onclick={() => loadConfig()}
                    >
                        {m.common_retry()}
                    </button>
                </div>
            </div>
        {:else if !hasContent}
            <div class="flex-1 flex items-center justify-center px-4">
                <p class="text-muted-foreground text-xs text-center">
                    {m.config_noConfigForAgent({ agentId })}
                </p>
            </div>
        {:else}
            <!-- Archetype picker — tailors which setting groups show below -->
            {#if archetypePath}
                <div class="shrink-0 px-4 py-3 border-b border-border">
                    <div class="flex items-baseline justify-between mb-2">
                        <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{m.settings_archetype()}</span>
                        <span class="text-[10px] text-muted-foreground/70">{m.settings_archetypeHint()}</span>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        {#each ARCHETYPES as a (a.id)}
                            {@const active = currentArchetype === a.id}
                            {@const Icon = a.icon}
                            <button
                                type="button"
                                onclick={() => pickArchetype(a.id)}
                                aria-pressed={active}
                                class="flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-colors {active
                                    ? 'border-accent bg-accent/10'
                                    : 'border-border hover:border-muted-foreground hover:bg-bg3'}"
                            >
                                <span class="flex items-center gap-1.5">
                                    <Icon size={14} class={active ? 'text-accent' : 'text-muted-foreground'} />
                                    <span class="text-xs font-semibold {active ? 'text-accent' : 'text-foreground'}">{a.label()}</span>
                                </span>
                                <span class="text-[10px] text-muted-foreground leading-tight">{a.desc()}</span>
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Two-column layout -->
            <div class="flex-1 flex min-h-0">
                <!-- Left nav -->
                <AgentSettingsNav
                    {activeSection}
                    onselect={(id) => (activeSection = id)}
                    groups={visibleGroups}
                    {enabledSkillCount}
                    totalSkillCount={agentSkillsState.skills.length}
                    bindingCount={bindingEntries.length}
                    bind:searchQuery
                />

                <!-- Right content column -->
                <div class="flex-1 overflow-y-auto min-h-0">
                    {#if activeSection === 'skills'}
                        <!-- Skills panel -->
                        <div class="p-4">
                            <AgentSkillsPanel {agentId} />
                        </div>
                    {:else if activeSection === 'bindings'}
                        <!-- Bindings section -->
                        <div class="p-4 space-y-3">
                            <h3 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider m-0">
                                {m.config_bindingsSection()}
                            </h3>
                            <p class="text-[10px] text-muted-foreground -mt-1">
                                {m.settings_bindingsDesc()}
                            </p>
                            {#each bindingEntries as [bindKey, bindVal] (bindKey)}
                                {@const bindPath = `bindings.${bindKey}`}
                                {@const bindSchema =
                                    bindingsSchema?.properties?.[bindKey] ??
                                    (typeof bindingsSchema?.additionalProperties ===
                                    "object"
                                        ? bindingsSchema.additionalProperties
                                        : { type: "string", title: bindKey })}
                                {@const bindHint =
                                    configState.uiHints[bindPath] ?? {}}
                                <ConfigField
                                    path={bindPath}
                                    schema={bindSchema}
                                    hint={bindHint}
                                    value={bindVal}
                                    depth={0}
                                />
                            {/each}
                        </div>
                    {:else if activeGroup}
                        <!-- Settings group content -->
                        <div class="p-4">
                            <!-- Defaults info banner (first visit only) -->
                            {#if isListStructure && activeSection === 'identity'}
                                <div
                                    class="mb-4 px-3 py-2 bg-accent/8 border border-accent/20 rounded-lg"
                                >
                                    <p class="text-[11px] text-muted-foreground leading-relaxed m-0">
                                        {m.config_inheritsDefaults()}
                                    </p>
                                </div>
                            {/if}

                            <!-- Group header -->
                            <div class="mb-4">
                                <div class="flex items-center gap-2 mb-1">
                                    <h3 class="text-sm font-semibold text-foreground m-0">
                                        {activeGroup.group.label}
                                    </h3>
                                    <span class="text-[10px] text-muted-foreground">
                                        {activeGroup.fields.length === 1
                                            ? m.config_fieldCount({ count: activeGroup.fields.length })
                                            : m.config_fieldCountPlural({ count: activeGroup.fields.length })}
                                    </span>
                                    {#if countOverrides(activeGroup.fields) > 0}
                                        <span class="text-[10px] text-accent">
                                            {m.config_overridesSet({ count: countOverrides(activeGroup.fields) })}
                                        </span>
                                    {/if}
                                </div>
                                {#if activeGroup.group.description}
                                    <p class="text-[10px] text-muted-foreground m-0">
                                        {activeGroup.group.description}
                                    </p>
                                {/if}
                            </div>

                            <!-- Agent ID chip (inside identity section) -->
                            {#if activeSection === 'identity'}
                                <div class="mb-4 flex items-center gap-2">
                                    <span class="text-[10px] text-muted-foreground">{m.settings_agentId()}</span>
                                    <button
                                        type="button"
                                        class="font-mono text-[10px] text-muted-foreground bg-bg3 border border-border rounded px-2 py-0.5
                                            hover:border-accent/40 hover:text-foreground cursor-pointer transition-colors truncate max-w-[300px]"
                                        onclick={copyAgentId}
                                        title={m.settings_clickToCopy()}
                                    >
                                        {idCopied ? m.settings_copied() : agentId}
                                    </button>
                                </div>
                            {/if}

                            <!-- Fields -->
                            <div class="space-y-1">
                                {#each searchFilteredFields as field (field.key)}
                                    <div
                                        class="relative group/field rounded-md
                                            {field.isOverridden ? 'border-l-2 border-l-accent pl-2' : 'pl-2'}"
                                    >
                                        <ConfigField
                                            path={field.path}
                                            schema={field.schema}
                                            hint={field.hint}
                                            value={field.value}
                                            depth={0}
                                        />
                                        <!-- Reset button for overridden fields -->
                                        {#if field.isOverridden && field.defaultValue !== undefined}
                                            <button
                                                type="button"
                                                class="absolute top-1 right-0 opacity-0 group-hover/field:opacity-100 bg-transparent border border-border rounded text-[10px] text-muted-foreground py-0.5 px-1.5 cursor-pointer transition-all hover:text-foreground hover:border-muted"
                                                onclick={() =>
                                                    resetField(field)}
                                                title="Reset to default: {JSON.stringify(
                                                    field.defaultValue,
                                                )}"
                                            >
                                                {m.common_reset()}
                                            </button>
                                        {/if}
                                    </div>
                                {/each}

                                {#if searchFilteredFields.length === 0 && searchQuery.trim()}
                                    <p class="text-[11px] text-muted-strong text-center py-6">
                                        {m.settings_noFieldsMatching({ query: searchQuery })}
                                    </p>
                                {/if}
                            </div>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Save/discard bar -->
            {#if isDirty.value || configState.saving || configState.saveError}
                <div
                    class="shrink-0 border-t border-border bg-bg2 px-4 py-3 flex items-center gap-2"
                >
                    {#if configState.saveError}
                        <span
                            class="text-destructive text-[11px] flex-1 truncate"
                        >
                            {configState.saveError}
                        </span>
                    {:else if configState.lastSavedAt && !isDirty.value}
                        <span class="text-success text-[11px] flex-1"
                            >{m.config_saved()}</span
                        >
                    {:else}
                        <span class="flex-1"></span>
                    {/if}

                    <button
                        type="button"
                        class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer font-[inherit] text-xs py-1.25 px-3 transition-colors hover:text-foreground disabled:opacity-40 disabled:cursor-default"
                        disabled={!isDirty.value || configState.saving}
                        onclick={() => discard()}
                    >
                        {m.saveBar_discard()}
                    </button>

                    <button
                        type="button"
                        class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-1.25 px-3 transition-[filter] hover:brightness-115 disabled:opacity-40 disabled:cursor-default flex items-center gap-2"
                        disabled={!isDirty.value || configState.saving}
                        onclick={() => save()}
                    >
                        {#if configState.saving}
                            <span
                                class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"
                            ></span>
                        {/if}
                        {m.common_save()}
                    </button>
                </div>
            {/if}
        {/if}
    </div>
</div>
