<script lang="ts">
    import { ui } from "$lib/state/ui.svelte";
    import {
        configState,
        loadConfig,
        isDirty,
        save,
        discard,
        setField,
    } from "$lib/state/config.svelte";
    import { deepGet } from "$lib/utils/config-schema";
    import {
        buildGroupedFields,
        type ResolvedGroup,
        type ResolvedField,
        type AgentStructure,
    } from "$lib/utils/agent-settings-schema";
    import ConfigField from "./config/ConfigField.svelte";
    import ConfigTooltip from "./config/ConfigTooltip.svelte";
    import AgentSkillsPanel from "./AgentSkillsPanel.svelte";
    import { SvelteSet } from "svelte/reactivity";
    import * as m from "$lib/paraglide/messages";

    let { agentId }: { agentId: string } = $props();

    // ─── Auto-load config on mount ───────────────────────────────────────────
    $effect(() => {
        if (!configState.loaded && !configState.loading) {
            loadConfig();
        }
    });

    // ─── Build grouped fields (re-derives when config changes) ─────────────
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

    // ─── Visibility: always show identity + model; show others if they have values
    const visibleGroups = $derived(
        resolvedGroups.filter(
            (g) =>
                g.group.id === "identity" ||
                g.group.id === "model" ||
                g.hasValues,
        ),
    );

    // ─── Expanded groups state ─────────────────────────────────────────────
    let expandedGroups = new SvelteSet(["identity", "model"]);

    function toggleGroup(groupId: string) {
        if (expandedGroups.has(groupId)) {
            expandedGroups.delete(groupId);
        } else {
            expandedGroups.add(groupId);
        }
    }

    // ─── Bindings that reference this agent ────────────────────────────────
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

    // ─── Reset a field (remove override, fall back to default) ─────────────
    function resetField(field: ResolvedField) {
        setField(field.path, undefined);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────
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
    <!-- Panel -->
    <div
        class="absolute top-0 right-0 h-full w-105 max-w-full bg-bg2 border-l border-border flex flex-col shadow-2xl"
        role="dialog"
        aria-label="Agent settings for {agentId}"
    >
        <!-- Header -->
        <div
            class="shrink-0 flex items-center gap-3 px-4 py-3.5 border-b border-border"
        >
            <span class="text-sm font-bold text-foreground truncate flex-1">
                {m.agent_settingsTitle({ agentId })}
            </span>
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
            <div class="flex-1 overflow-y-auto">
                <!-- Defaults info banner -->
                {#if isListStructure}
                    <div
                        class="mx-4 mt-3 px-3 py-2 bg-accent/8 border border-accent/20 rounded-lg"
                    >
                        <p
                            class="text-[11px] text-muted-foreground leading-relaxed m-0"
                        >
                            {m.config_inheritsDefaults()}
                        </p>
                    </div>
                {/if}

                <!-- Skills management -->
                <div class="px-4 pt-3">
                    <AgentSkillsPanel {agentId} />
                </div>

                <!-- Grouped settings sections -->
                <div class="px-4 py-3 space-y-2">
                    {#each visibleGroups as { group, fields } (group.id)}
                        {@const isExpanded = expandedGroups.has(group.id)}
                        {@const overrideCount = countOverrides(fields)}

                        <section>
                            <!-- Section header -->
                            <button
                                type="button"
                                class="w-full flex items-center gap-2.5 px-3 py-2.5 bg-card border border-border cursor-pointer transition-colors hover:bg-bg3
                  {isExpanded ? 'rounded-t-lg border-b-0' : 'rounded-lg'}"
                                onclick={() => toggleGroup(group.id)}
                            >
                                <span
                                    class="text-muted-foreground text-[9px] transition-transform {isExpanded
                                        ? 'rotate-90'
                                        : ''}">&#9654;</span
                                >

                                <span
                                    class="flex flex-col items-start gap-0.5 min-w-0"
                                >
                                    <span class="flex items-center gap-2">
                                        <span
                                            class="text-[11px] font-semibold text-foreground uppercase tracking-wider"
                                            >{group.label}</span
                                        >
                                        <span
                                            class="text-[10px] text-muted-foreground"
                                            >{fields.length === 1 ? m.config_fieldCount({ count: fields.length }) : m.config_fieldCountPlural({ count: fields.length })}</span
                                        >
                                        {#if overrideCount > 0}
                                            <span
                                                class="text-[10px] text-accent"
                                                >{m.config_overridesSet({ count: overrideCount })}</span
                                            >
                                        {/if}
                                    </span>
                                    {#if group.description}
                                        <span
                                            class="text-[10px] text-muted-foreground leading-tight truncate max-w-full"
                                            >{group.description}</span
                                        >
                                    {/if}
                                </span>

                                <span class="flex-1"></span>

                                {#if overrideCount > 0}
                                    <span
                                        class="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                                    ></span>
                                {/if}
                            </button>

                            <!-- Section body -->
                            {#if isExpanded}
                                <div
                                    class="bg-card border border-border border-t-0 rounded-b-lg p-3 space-y-1"
                                >
                                    {#each fields as field (field.key)}
                                        <div class="relative group/field">
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
                                </div>
                            {/if}
                        </section>
                    {/each}
                </div>

                <!-- Bindings section -->
                {#if bindingEntries.length > 0}
                    <div
                        class="border-t border-border mx-4 pt-3 pb-4 space-y-3"
                    >
                        <h3
                            class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider m-0"
                        >
                            {m.config_bindingsSection()}
                        </h3>
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
                {/if}
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
