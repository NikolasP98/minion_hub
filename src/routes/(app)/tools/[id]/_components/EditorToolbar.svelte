<script lang="ts">
  import { Button, Select } from '$lib/components/ui';
import {
        ArrowLeft,
        Wrench,
        Play,
        Upload,
        Loader2,
        Check,
        Circle,
        Power,
        PowerOff,
    } from "lucide-svelte";
    import type { ToolStatusEntry } from "$lib/types/tools";
    import * as m from '$lib/paraglide/messages';
    import { createBackNav } from '$lib/nav/back-nav.svelte';

    const back = createBackNav('/tools', () => 'Tools');

    type Lang = "javascript" | "python" | "bash";
    type Status = "draft" | "published";
    type PermAction = "view" | "create" | "edit" | "delete" | "export" | "manage";

    // Static list mirroring `$server/services/rbac.service.ts` MODULES — kept
    // as ids only (no imported label map) so this client component never
    // pulls in server-only code; labels just capitalize the id via CSS.
    const PERM_MODULES = [
        "overview", "crm", "finance", "sales", "scheduling", "support", "projects",
        "memberships", "comms", "brains", "stock", "ads", "pos", "agents", "channels",
        "flows", "marketplace", "reliability", "settings", "users", "tools",
    ] as const;
    const PERM_ACTIONS: PermAction[] = ["view", "create", "edit", "delete", "export", "manage"];

    interface Props {
        isAdmin: boolean;
        isGatewayTool: boolean;
        gatewayTool: ToolStatusEntry | null;
        name: string;
        status: Status;
        scriptLang: Lang;
        langOptions: Array<{ id: Lang; label: string }>;
        saving: boolean;
        dirty: boolean;
        running: boolean;
        publishing: boolean;
        permModule: string;
        permAction: PermAction;
        onNameInput: () => void;
        onSwitchLanguage: (lang: Lang) => void;
        onRunTool: () => void;
        onPublishTool: () => void;
        onToggleGatewayToolEnabled: () => void;
        onPermChange: () => void;
    }

    let {
        isAdmin,
        isGatewayTool,
        gatewayTool,
        name = $bindable(),
        status,
        scriptLang,
        langOptions,
        saving,
        dirty,
        running,
        publishing,
        permModule = $bindable(),
        permAction = $bindable(),
        onNameInput,
        onSwitchLanguage,
        onRunTool,
        onPublishTool,
        onToggleGatewayToolEnabled,
        onPermChange,
    }: Props = $props();
</script>

<div class="editor-toolbar">
    <div class="toolbar-left">
        <Button variant="ghost" type="button" onclick={back.go} class="back-link" title="Back to Tools">
            <ArrowLeft size={16} />
        </Button>

        <div class="toolbar-divider"></div>

        <div class="toolbar-identity">
            <Wrench size={16} class="tool-icon" />
            {#if isGatewayTool || !isAdmin}
                <span class="name-inline-ro">{name}</span>
            {:else}
                <input
                    type="text"
                    class="name-inline"
                    bind:value={name}
                    placeholder={m.builder_toolNamePlaceholder()}
                    oninput={onNameInput}
                />
            {/if}
            <span class="status-badge {status}">
                {status}
            </span>
            <span class="toolbar-source">{isGatewayTool ? m.builder_gatewaySource() : m.builder_customSource()}</span>

            {#if !isGatewayTool && isAdmin}
                <div class="toolbar-divider"></div>
                <div class="perm-picker">
                    <Select size="sm"
                        class="perm-select"
                        aria-label={m.tools_editor_permissionModuleLabel()}
                        bind:value={permModule}
                        onchange={() => onPermChange()}
                    >
                        <option value="">{m.tools_editor_permissionNone()}</option>
                        {#each PERM_MODULES as mod (mod)}
                            <option value={mod}>{mod}</option>
                        {/each}
                    </Select>
                    {#if permModule}
                        <Select size="sm"
                            class="perm-select"
                            aria-label={m.tools_editor_permissionActionLabel()}
                            bind:value={permAction}
                            onchange={() => onPermChange()}
                        >
                            {#each PERM_ACTIONS as act (act)}
                                <option value={act}>{act}</option>
                            {/each}
                        </Select>
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <div class="toolbar-right">
        {#if isGatewayTool && gatewayTool}
            <!-- Gateway tool: enable/disable toggle (admin only) -->
            {#if isAdmin}
                <div class="toolbar-divider"></div>
                <Button variant="ghost"
                    type="button"
                    class="toolbar-btn {gatewayTool.enabled ? 'published' : 'run'}"
                    onclick={onToggleGatewayToolEnabled}
                    title={gatewayTool.enabled ? m.builder_disableTool() : m.builder_enableTool()}
                >
                    {#if gatewayTool.enabled}
                        <PowerOff size={14} />
                        <span class="hidden-sm">{m.builder_disable()}</span>
                    {:else}
                        <Power size={14} />
                        <span class="hidden-sm">{m.builder_enable()}</span>
                    {/if}
                </Button>
            {/if}
        {:else}
            <!-- Custom builder tool: IDE toolbar -->
            {#if isAdmin}
                <!-- Language Selector -->
                <div class="lang-selector">
                    {#each langOptions as lang (lang.id)}
                        <Button variant="ghost"
                            type="button"
                            class="lang-pill {scriptLang === lang.id ? 'active' : ''}"
                            onclick={() => onSwitchLanguage(lang.id)}
                        >
                            {lang.label}
                        </Button>
                    {/each}
                </div>

                <div class="toolbar-divider"></div>

                <!-- Run Button -->
                <Button variant="ghost"
                    type="button"
                    class="toolbar-btn run"
                    onclick={onRunTool}
                    disabled={running}
                    title={m.builder_runScript()}
                >
                    {#if running}
                        <Loader2 size={14} class="loading-spinner" />
                    {:else}
                        <Play size={14} />
                    {/if}
                    <span class="hidden-sm">{m.builder_run()}</span>
                </Button>

                <div class="toolbar-divider"></div>

                <!-- Save Indicator -->
                <span
                    class="save-indicator"
                    title={saving ? m.builder_saving() : dirty ? m.builder_unsavedChanges() : m.builder_allSaved()}
                >
                    {#if saving}
                        <Loader2 size={12} class="loading-spinner" />
                        <span>{m.builder_saving()}</span>
                    {:else if dirty}
                        <Circle size={8} class="dirty-dot" />
                        <span>{m.builder_unsaved()}</span>
                    {:else}
                        <Check size={12} class="saved-check" />
                        <span>{m.builder_saved()}</span>
                    {/if}
                </span>

                <!-- Publish Button -->
                <Button variant="ghost"
                    type="button"
                    class="toolbar-btn {status === 'published' ? 'published' : 'primary'}"
                    onclick={onPublishTool}
                    disabled={publishing}
                    title={status === "published"
                        ? m.builder_republishLatest()
                        : m.builder_publishTool()}
                >
                    {#if publishing}
                        <Loader2 size={14} class="loading-spinner" />
                    {:else}
                        <Upload size={14} />
                    {/if}
                    <span class="hidden-sm"
                        >{publishing
                            ? m.builder_publishing()
                            : status === "published"
                                ? m.builder_republish()
                                : m.builder_publish()}</span
                    >
                </Button>
            {:else}
                <span class="toolbar-source">{scriptLang}</span>
            {/if}
        {/if}
    </div>
</div>

<style>
    /* ── Editor Toolbar ──────────────────────────────────────────────── */
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        min-height: 2.75rem;
        padding: var(--space-1) var(--space-3);
        row-gap: var(--space-1);
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: var(--space-2);
    }

    /* Reserve the top-right notch so the right-side actions (Run / Publish /
       Disable) never sit under the global notch. */
    @media (min-width: 768px) {
        .editor-toolbar {
            padding-right: var(--notch-clearance);
        }
    }

    .toolbar-left {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
    }

    .toolbar-right {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-shrink: 0;
    }

    .toolbar-divider {
        width: 1px;
        height: 1.25rem;
        background: var(--color-border);
        opacity: 0.6;
        flex-shrink: 0;
    }

    .back-link {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: var(--radius-md);
        color: var(--color-muted);
        transition: all var(--duration-fast) var(--ease-standard);
        flex-shrink: 0;
        background: none;
        border: none;
        cursor: pointer;
    }

    .back-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .toolbar-identity {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
    }

    :global(.tool-icon) {
        color: var(--color-accent);
        flex-shrink: 0;
    }

    .name-inline {
        font-size: var(--font-size-body);
        font-weight: 600;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 1px solid transparent;
        padding: var(--space-0-5) 0;
        outline: none;
        font-family: inherit;
        min-width: 6rem;
        max-width: 16rem;
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .name-inline:focus {
        border-bottom-color: var(--color-accent);
    }

    .name-inline::placeholder {
        color: var(--color-muted);
    }

    .name-inline-ro {
        font-size: var(--font-size-body);
        font-weight: 600;
        color: var(--color-foreground);
        padding: var(--space-0-5) 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 16rem;
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        padding: var(--space-0-5) var(--space-2);
        border-radius: var(--radius-full);
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        flex-shrink: 0;
    }

    .status-badge.draft {
        color: var(--color-warning);
        background: color-mix(in srgb, var(--color-warning) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-warning) 25%, transparent);
    }

    .status-badge.published {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
    }

    /* ── Language Selector ────────────────────────────────────────────── */
    .lang-selector {
        display: flex;
        align-items: center;
        gap: var(--space-0-5);
        padding: var(--space-0-5);
        border-radius: var(--radius-md);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
    }

    .lang-pill {
        display: flex;
        align-items: center;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-caption);
        font-weight: 500;
        color: var(--color-muted);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        font-family: inherit;
        white-space: nowrap;
    }

    .lang-pill:hover {
        color: var(--color-foreground);
    }

    .lang-pill.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        box-shadow: var(--shadow-elevation-1);
    }

    /* ── Toolbar Buttons ─────────────────────────────────────────────── */
    .toolbar-btn {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-2);
        border-radius: var(--radius-md);
        font-size: var(--font-size-caption);
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        font-family: inherit;
    }

    .toolbar-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .toolbar-btn.run {
        color: var(--color-bg);
        background: var(--color-accent);
    }

    .toolbar-btn.run:hover:not(:disabled) {
        filter: brightness(1.15);
    }

    .toolbar-btn.primary {
        color: white;
        background: var(--color-accent);
    }

    .toolbar-btn.primary:hover:not(:disabled) {
        filter: brightness(1.1);
    }

    .toolbar-btn.published {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
    }

    .toolbar-btn.published:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-success) 20%, transparent);
    }

    /* ── Save Indicator ──────────────────────────────────────────────── */
    .save-indicator {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        white-space: nowrap;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-md);
        user-select: none;
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    :global(.dirty-dot) {
        color: var(--color-warning, var(--color-warning-fg));
        fill: var(--color-warning, var(--color-warning-fg));
    }

    :global(.saved-check) {
        color: var(--color-success, var(--color-success-fg));
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    /* ── Hidden on small screens ──────────────────────────────────────── */
    .hidden-sm {
        display: none;
    }

    @media (min-width: 640px) {
        .hidden-sm {
            display: inline;
        }
    }

    /* ── Toolbar Source Label ──────────────────────────────────────── */
    .toolbar-source {
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
        font-family: var(--font-mono, monospace);
    }

    /* ── Permission Picker ───────────────────────────────────────────── */
    .perm-picker {
        display: flex;
        align-items: center;
        gap: var(--space-1);
    }

    .perm-select {
        font-size: var(--font-size-caption);
        font-weight: 500;
        text-transform: capitalize;
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-1) var(--space-2);
        font-family: inherit;
        cursor: pointer;
    }
</style>
