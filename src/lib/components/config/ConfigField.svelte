<script lang="ts">
    import type { JsonSchemaNode, ConfigUiHint } from "$lib/types/config";
    import { REDACTED_SENTINEL } from "$lib/types/config";
    import { resolveFieldType } from "$lib/utils/config-schema";
    import { hasConfiguredValues } from "$lib/utils/config-schema";
    import {
        setField,
        getOriginalField,
        configState,
    } from "$lib/state/config.svelte";
    import ConfigJsonEditor from "./ConfigJsonEditor.svelte";
    import ConfigField from "./ConfigField.svelte";
    import ConfigTooltip from "./ConfigTooltip.svelte";
    import ToggleSwitch from "./ToggleSwitch.svelte";

    let {
        path,
        schema,
        hint = {},
        value,
        depth = 0,
    }: {
        path: string;
        schema: JsonSchemaNode;
        hint?: ConfigUiHint;
        value: unknown;
        depth?: number;
    } = $props();

    const fieldType = $derived(resolveFieldType(schema, hint));
    const label = $derived(hint.label ?? schema.title ?? lastSegment(path));
    const helpText = $derived(hint.help ?? schema.description);
    const isRedacted = $derived(value === REDACTED_SENTINEL);
    const placeholder = $derived(
        hint.placeholder ?? schema.default?.toString() ?? "",
    );

    // Sub-group collapse state (for nested objects at depth > 0)
    let subGroupOpen = $state<boolean | null>(null);
    const subGroupExpanded = $derived(
        subGroupOpen ?? hasConfiguredValues(value),
    );

    // For sensitive fields
    let showSensitive = $state(false);

    // For record (key-value) fields
    let newRecordKey = $state("");

    // For array-string fields
    let newArrayItem = $state("");

    // ─── Tooltip content builder ──────────────────────────────────────────────

    function buildTooltip(): string {
        const parts: string[] = [];
        if (helpText) parts.push(helpText);

        // Enrich with enum option descriptions for select/enum fields
        if (fieldType === "enum" && schema.enum) {
            const opts = schema.enum.map((o) => String(o)).join(", ");
            parts.push(`Options: ${opts}`);
        } else if (fieldType === "select") {
            const variants = schema.anyOf ?? schema.oneOf ?? [];
            const opts = variants
                .map((v) => {
                    const val = v.const ?? v.enum?.[0];
                    const lbl = v.title ?? String(val);
                    return v.description ? `${lbl} — ${v.description}` : lbl;
                })
                .join("; ");
            if (opts) parts.push(`Options: ${opts}`);
        }

        return parts.join("\n");
    }

    const tooltipContent = $derived(buildTooltip());

    // ─── Event handlers ─────────────────────────────────────────────────────

    function onStringInput(e: Event) {
        setField(path, (e.target as HTMLInputElement).value);
    }

    function onNumberInput(e: Event) {
        const raw = (e.target as HTMLInputElement).value;
        if (raw === "") {
            setField(path, undefined);
        } else {
            const num = Number(raw);
            if (!Number.isNaN(num)) setField(path, num);
        }
    }

    function onBooleanToggle(checked: boolean) {
        setField(path, checked);
    }

    function onEnumSelect(e: Event) {
        const val = (e.target as HTMLSelectElement).value;
        setField(path, val === "__NONE__" ? undefined : val);
    }

    function onSelectChange(e: Event) {
        const raw = (e.target as HTMLSelectElement).value;
        if (raw === "__NONE__") {
            setField(path, undefined);
            return;
        }
        // Try to parse as JSON for typed const values
        try {
            setField(path, JSON.parse(raw));
        } catch {
            setField(path, raw);
        }
    }

    function onSensitiveInput(e: Event) {
        setField(path, (e.target as HTMLInputElement).value);
    }

    function resetSensitive() {
        const orig = getOriginalField(path);
        setField(path, orig);
        showSensitive = false;
    }

    // Array-string helpers
    function addArrayItem() {
        const trimmed = newArrayItem.trim();
        if (!trimmed) return;
        const arr = Array.isArray(value) ? [...(value as string[])] : [];
        arr.push(trimmed);
        setField(path, arr);
        newArrayItem = "";
    }

    function removeArrayItem(index: number) {
        if (!Array.isArray(value)) return;
        const arr = [...(value as string[])];
        arr.splice(index, 1);
        setField(path, arr);
    }

    // Record helpers
    function addRecordEntry() {
        const key = newRecordKey.trim();
        if (!key) return;
        const obj =
            value && typeof value === "object" && !Array.isArray(value)
                ? { ...(value as Record<string, unknown>) }
                : {};
        obj[key] = "";
        setField(path, obj);
        newRecordKey = "";
    }

    function removeRecordEntry(key: string) {
        if (!value || typeof value !== "object") return;
        const obj = { ...(value as Record<string, unknown>) };
        delete obj[key];
        setField(path, obj);
    }

    function onRecordValueInput(key: string, e: Event) {
        const obj =
            value && typeof value === "object" && !Array.isArray(value)
                ? { ...(value as Record<string, unknown>) }
                : {};
        obj[key] = (e.target as HTMLInputElement).value;
        setField(path, obj);
    }

    // Array-object helpers
    function addArrayObject() {
        const arr = Array.isArray(value) ? [...(value as unknown[])] : [];
        arr.push({});
        setField(path, arr);
    }

    function removeArrayObject(index: number) {
        if (!Array.isArray(value)) return;
        const arr = [...(value as unknown[])];
        arr.splice(index, 1);
        setField(path, arr);
    }

    // Multi-enum helpers
    function isChecked(option: unknown): boolean {
        return Array.isArray(value) && (value as unknown[]).includes(option);
    }

    function toggleMultiEnum(option: unknown) {
        const arr = Array.isArray(value) ? [...(value as unknown[])] : [];
        const idx = arr.indexOf(option);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(option);
        setField(path, arr);
    }

    function lastSegment(p: string): string {
        const parts = p.split(".");
        return parts[parts.length - 1];
    }

    // Select variants helper
    function getSelectOptions(
        s: JsonSchemaNode,
    ): { label: string; value: string }[] {
        const variants = s.anyOf ?? s.oneOf ?? [];
        return variants.map((v) => {
            const val = v.const ?? v.enum?.[0];
            return {
                label: v.title ?? String(val),
                value: JSON.stringify(val),
            };
        });
    }

    // Count child properties for sub-group header
    function countProperties(s: JsonSchemaNode): number {
        return s.properties ? Object.keys(s.properties).length : 0;
    }

    const inputClass =
        "bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] font-[inherit] text-xs outline-none transition-colors focus:border-accent w-full";
    const labelClass = "text-[11px] text-muted-foreground";
</script>

{#snippet fieldLabel(text: string, tip: string)}
    <span class="inline-flex items-center gap-1.5">
        <span class={labelClass}>{text}</span>
        {#if tip}
            <ConfigTooltip content={tip}>
                <span
                    class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-[9px] text-muted-foreground cursor-help leading-none hover:text-foreground hover:border-muted transition-colors"
                    >?</span
                >
            </ConfigTooltip>
        {/if}
    </span>
{/snippet}

<!-- ─── Render based on field type ──────────────────────────────────── -->

{#if fieldType === "object"}
    <!-- Nested object: render each property recursively -->
    {@const hasEnabledToggle =
        schema.properties?.enabled &&
        resolveFieldType(schema.properties.enabled) === "boolean"}
    {@const enabledValue =
        hasEnabledToggle && value != null && typeof value === "object"
            ? (value as Record<string, unknown>).enabled
            : true}

    {#if depth > 0}
        <!-- Sub-group collapsible -->
        <div class="pl-3 border-l border-border">
            <button
                type="button"
                class="w-full flex items-center gap-2 py-1.5 bg-transparent border-none cursor-pointer text-left group"
                onclick={() => (subGroupOpen = !subGroupExpanded)}
            >
                <span
                    class="text-muted-foreground text-[9px] transition-transform {subGroupExpanded
                        ? 'rotate-90'
                        : ''}">&#9654;</span
                >
                <span class="text-[11px] font-semibold text-foreground"
                    >{label}</span
                >
                <span class="text-[10px] text-muted-foreground"
                    >{countProperties(schema)} field{countProperties(schema) ===
                    1
                        ? ""
                        : "s"}</span
                >
                {#if tooltipContent}
                    <ConfigTooltip content={tooltipContent}>
                        <span
                            class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-[9px] text-muted-foreground cursor-help leading-none hover:text-foreground hover:border-muted transition-colors"
                            >?</span
                        >
                    </ConfigTooltip>
                {/if}
            </button>

            {#if subGroupExpanded}
                <div class="space-y-3 pt-1.5">
                    {#if schema.properties}
                        {#if hasEnabledToggle}
                            {@const enabledPath = `${path}.enabled`}
                            {@const enabledHint =
                                configState.uiHints[enabledPath] ?? {}}
                            {@const enabledVal =
                                value != null && typeof value === "object"
                                    ? (value as Record<string, unknown>).enabled
                                    : undefined}
                            <ConfigField
                                path={enabledPath}
                                schema={schema.properties.enabled}
                                hint={enabledHint}
                                value={enabledVal}
                                depth={depth + 1}
                            />
                        {/if}

                        {#if enabledValue || !hasEnabledToggle}
                            {#each Object.entries(schema.properties) as [key, propSchema] (key)}
                                {#if !(hasEnabledToggle && key === "enabled")}
                                    {@const childPath = `${path}.${key}`}
                                    {@const childHint =
                                        configState.uiHints[childPath] ?? {}}
                                    {@const childValue =
                                        value != null &&
                                        typeof value === "object"
                                            ? (
                                                  value as Record<
                                                      string,
                                                      unknown
                                                  >
                                              )[key]
                                            : undefined}
                                    <ConfigField
                                        path={childPath}
                                        schema={propSchema}
                                        hint={childHint}
                                        value={childValue}
                                        depth={depth + 1}
                                    />
                                {/if}
                            {/each}
                        {/if}
                    {/if}
                </div>
            {/if}
        </div>
    {:else}
        <!-- Top-level object (depth 0): render children directly -->
        <fieldset class="border-none p-0 m-0 space-y-3">
            {#if schema.properties}
                {#if hasEnabledToggle}
                    {@const enabledPath = `${path}.enabled`}
                    {@const enabledHint =
                        configState.uiHints[enabledPath] ?? {}}
                    {@const enabledVal =
                        value != null && typeof value === "object"
                            ? (value as Record<string, unknown>).enabled
                            : undefined}
                    <ConfigField
                        path={enabledPath}
                        schema={schema.properties.enabled}
                        hint={enabledHint}
                        value={enabledVal}
                        depth={depth + 1}
                    />
                {/if}

                {#if enabledValue || !hasEnabledToggle}
                    {#each Object.entries(schema.properties) as [key, propSchema] (key)}
                        {#if !(hasEnabledToggle && key === "enabled")}
                            {@const childPath = `${path}.${key}`}
                            {@const childHint =
                                configState.uiHints[childPath] ?? {}}
                            {@const childValue =
                                value != null && typeof value === "object"
                                    ? (value as Record<string, unknown>)[key]
                                    : undefined}
                            <ConfigField
                                path={childPath}
                                schema={propSchema}
                                hint={childHint}
                                value={childValue}
                                depth={depth + 1}
                            />
                        {/if}
                    {/each}
                {/if}
            {/if}
        </fieldset>
    {/if}
{:else if fieldType === "sensitive"}
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        <div class="flex gap-2 items-center">
            <input
                class={inputClass}
                type={showSensitive ? "text" : "password"}
                value={isRedacted ? "" : ((value as string) ?? "")}
                placeholder={isRedacted
                    ? "Redacted — type to replace"
                    : placeholder}
                oninput={onSensitiveInput}
            />
            <button
                type="button"
                class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-[11px] py-1.25 px-2 shrink-0 transition-colors hover:text-foreground"
                onclick={() => (showSensitive = !showSensitive)}
                title={showSensitive ? "Hide" : "Show"}
            >
                {showSensitive ? "Hide" : "Show"}
            </button>
            {#if !isRedacted && value !== getOriginalField(path)}
                <button
                    type="button"
                    class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-[11px] py-1.25 px-2 shrink-0 transition-colors hover:text-foreground"
                    onclick={resetSensitive}
                >
                    Reset
                </button>
            {/if}
        </div>
    </div>
{:else if fieldType === "boolean"}
    <div class="flex items-center gap-3 py-1">
        <ToggleSwitch id={path} checked={!!value} onchange={onBooleanToggle} />
        {@render fieldLabel(label, tooltipContent)}
    </div>
{:else if fieldType === "enum"}
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        <select
            class={inputClass}
            value={value ?? "__NONE__"}
            onchange={onEnumSelect}
        >
            <option value="__NONE__">— none —</option>
            {#each schema.enum ?? [] as option}
                <option value={String(option)}>{String(option)}</option>
            {/each}
        </select>
    </div>
{:else if fieldType === "select"}
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        <select
            class={inputClass}
            value={value !== undefined ? JSON.stringify(value) : "__NONE__"}
            onchange={onSelectChange}
        >
            <option value="__NONE__">— none —</option>
            {#each getSelectOptions(schema) as opt}
                <option value={opt.value}>{opt.label}</option>
            {/each}
        </select>
    </div>
{:else if fieldType === "number"}
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        <input
            class={inputClass}
            type="number"
            value={value ?? ""}
            min={schema.minimum}
            max={schema.maximum}
            {placeholder}
            oninput={onNumberInput}
        />
    </div>
{:else if fieldType === "string"}
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        <input
            class={inputClass}
            type="text"
            value={value ?? ""}
            {placeholder}
            oninput={onStringInput}
        />
    </div>
{:else if fieldType === "array-string"}
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        <div class="flex flex-wrap gap-1.5 mb-1.5">
            {#each Array.isArray(value) ? (value as string[]) : [] as item, i}
                <span
                    class="inline-flex items-center gap-1 bg-bg3 border border-border rounded-full py-0.5 pl-2.5 pr-1 text-xs text-foreground"
                >
                    {item}
                    <button
                        type="button"
                        class="bg-transparent border-none text-muted-foreground cursor-pointer text-[10px] p-0 leading-none hover:text-destructive"
                        onclick={() => removeArrayItem(i)}>&times;</button
                    >
                </span>
            {/each}
        </div>
        <div class="flex gap-1.5">
            <input
                class={inputClass}
                type="text"
                bind:value={newArrayItem}
                placeholder="Add item…"
                onkeydown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        addArrayItem();
                    }
                }}
            />
            <button
                type="button"
                class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-xs py-1.25 px-2 shrink-0 transition-colors hover:text-foreground"
                onclick={addArrayItem}>Add</button
            >
        </div>
    </div>
{:else if fieldType === "array-enum"}
    {@const items = Array.isArray(schema.items)
        ? schema.items[0]
        : schema.items}
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        {#if items?.enum}
            <div class="flex flex-wrap gap-2">
                {#each items.enum as option}
                    <label
                        class="inline-flex items-center gap-1.5 text-xs text-foreground cursor-pointer"
                    >
                        <input
                            type="checkbox"
                            class="accent-accent"
                            checked={isChecked(option)}
                            onchange={() => toggleMultiEnum(option)}
                        />
                        {String(option)}
                    </label>
                {/each}
            </div>
        {/if}
    </div>
{:else if fieldType === "record"}
    {@const entries =
        value && typeof value === "object" && !Array.isArray(value)
            ? Object.entries(value as Record<string, unknown>)
            : []}
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        <div class="space-y-1.5">
            {#each entries as [key, val]}
                <div class="flex gap-1.5 items-center">
                    <span
                        class="text-xs text-muted-foreground font-mono min-w-20 shrink-0"
                        >{key}</span
                    >
                    <input
                        class={inputClass}
                        type="text"
                        value={String(val ?? "")}
                        oninput={(e) => onRecordValueInput(key, e)}
                    />
                    <button
                        type="button"
                        class="bg-transparent border-none text-muted-foreground cursor-pointer text-xs p-1 hover:text-destructive shrink-0"
                        onclick={() => removeRecordEntry(key)}>&times;</button
                    >
                </div>
            {/each}
        </div>
        <div class="flex gap-1.5 mt-1">
            <input
                class={inputClass}
                type="text"
                bind:value={newRecordKey}
                placeholder="New key…"
                onkeydown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        addRecordEntry();
                    }
                }}
            />
            <button
                type="button"
                class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-xs py-1.25 px-2 shrink-0 transition-colors hover:text-foreground"
                onclick={addRecordEntry}>Add</button
            >
        </div>
    </div>
{:else if fieldType === "array-object"}
    {@const items = Array.isArray(schema.items)
        ? schema.items[0]
        : schema.items}
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        {#each Array.isArray(value) ? (value as unknown[]) : [] as item, i}
            <div class="border border-border rounded-lg p-3 space-y-3 relative">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] text-muted-foreground font-mono"
                        >#{i}</span
                    >
                    <button
                        type="button"
                        class="bg-transparent border-none text-muted-foreground cursor-pointer text-xs hover:text-destructive"
                        onclick={() => removeArrayObject(i)}>Remove</button
                    >
                </div>
                {#if items?.properties}
                    {#each Object.entries(items.properties) as [key, propSchema] (key)}
                        {@const childPath = `${path}.${i}.${key}`}
                        {@const childHint =
                            configState.uiHints[childPath] ??
                            configState.uiHints[`${path}[].${key}`] ??
                            configState.uiHints[`${path}.*.${key}`] ??
                            {}}
                        {@const childValue =
                            item != null && typeof item === "object"
                                ? (item as Record<string, unknown>)[key]
                                : undefined}
                        <ConfigField
                            path={childPath}
                            schema={propSchema}
                            hint={childHint}
                            value={childValue}
                            depth={depth + 1}
                        />
                    {/each}
                {:else}
                    <ConfigJsonEditor {path} pathSuffix=".{i}" value={item} />
                {/if}
            </div>
        {/each}
        <button
            type="button"
            class="bg-transparent border border-dashed border-border rounded-[5px] text-muted-foreground cursor-pointer text-xs py-1.5 px-3 transition-colors hover:border-accent hover:text-foreground w-full"
            onclick={addArrayObject}>+ Add Item</button
        >
    </div>
{:else}
    <!-- json fallback -->
    <div class="flex flex-col gap-1.5 py-1">
        {@render fieldLabel(label, tooltipContent)}
        <ConfigJsonEditor {path} {value} />
    </div>
{/if}
