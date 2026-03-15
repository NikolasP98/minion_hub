<script lang="ts">
    import { page } from "$app/state";
    import Topbar from "$lib/components/layout/Topbar.svelte";
    import {
        ArrowLeft,
        Wrench,
        Play,
        Eye,
        EyeOff,
        Upload,
        Loader2,
        Check,
        Circle,
        Plus,
        X,
        Trash2,
        Terminal,
        ChevronDown,
        ChevronRight,
        Power,
        PowerOff,
    } from "lucide-svelte";
    import { onMount } from "svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import { isAdmin as hubIsAdmin } from "$lib/state/features/user.svelte";
    import type { ToolStatusEntry, ToolsStatusReport } from "$lib/types/tools";

    const isAdmin = $derived(hubIsAdmin.value);

    const toolId = $derived(page.params.id);

    // ── Mode: gateway tool vs custom builder tool ───────────────────────
    let isGatewayTool = $state(false);
    let gatewayTool = $state<ToolStatusEntry | null>(null);

    // ── Form state ──────────────────────────────────────────────────────
    let name = $state("Untitled Tool");
    let description = $state("");
    let scriptCode = $state("// Write your tool script here\n");
    let scriptLang = $state<"javascript" | "python" | "bash">("javascript");
    let envVars = $state<Array<{ key: string; value: string; revealed: boolean }>>([]);
    let status = $state<"draft" | "published">("draft");
    let loading = $state(true);
    let saving = $state(false);
    let dirty = $state(false);
    let publishing = $state(false);
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Console state ───────────────────────────────────────────────────
    let consoleLines = $state<Array<{ text: string; type: "stdout" | "stderr" | "system" }>>([
        { text: "Ready. Click Run to execute.", type: "system" },
    ]);
    let running = $state(false);

    // ── Env vars panel ──────────────────────────────────────────────────
    let envVarsExpanded = $state(true);

    // ── Console element ref ─────────────────────────────────────────────
    let consoleEl: HTMLDivElement | undefined = $state(undefined);

    // ── Language options ────────────────────────────────────────────────
    const langOptions: Array<{ id: "javascript" | "python" | "bash"; label: string }> = [
        { id: "javascript", label: "JS" },
        { id: "python", label: "Python" },
        { id: "bash", label: "Bash" },
    ];

    // ── Default code templates ──────────────────────────────────────────
    const defaultCode: Record<string, string> = {
        javascript: "// Write your tool script here\n",
        python: "# Write your tool script here\n",
        bash: "#!/bin/bash\n# Write your tool script here\n",
    };

    // ── Actions ─────────────────────────────────────────────────────────
    function scheduleSave() {
        if (isGatewayTool) return;
        dirty = true;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveTool(), 2000);
    }

    async function saveTool() {
        saving = true;
        try {
            const envObj: Record<string, string> = {};
            for (const v of envVars) {
                if (v.key) envObj[v.key] = v.value;
            }
            const res = await fetch(`/api/builder/tools/${toolId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    description,
                    scriptCode,
                    scriptLang,
                    envVars: JSON.stringify(envObj),
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            dirty = false;
        } catch (e) {
            console.error("[tool-editor] Save failed:", e);
        } finally {
            saving = false;
        }
    }

    async function publishTool() {
        if (dirty) await saveTool();
        publishing = true;
        try {
            const res = await fetch(`/api/builder/tools/${toolId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'publish' }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            status = "published";
        } catch (e) {
            console.error("[tool-editor] Publish failed:", e);
        } finally {
            publishing = false;
        }
    }

    async function toggleGatewayToolEnabled() {
        if (!gatewayTool) return;
        const newEnabled = !gatewayTool.enabled;
        try {
            await sendRequest('tools.update', { toolId: gatewayTool.id, enabled: newEnabled });
            gatewayTool = { ...gatewayTool, enabled: newEnabled };
            status = newEnabled ? 'published' : 'draft';
        } catch (e) {
            console.error("[tool-editor] Toggle failed:", e);
        }
    }

    function runTool() {
        if (running) return;
        running = true;
        const now = new Date().toLocaleTimeString();
        consoleLines = [
            ...consoleLines,
            { text: `[${now}] Running ${scriptLang} script...`, type: "system" },
        ];
        scrollConsole();

        // Simulate: not connected yet
        setTimeout(() => {
            consoleLines = [
                ...consoleLines,
                { text: "Execution not yet connected to gateway.", type: "stderr" },
                { text: `[exit 1] duration: 0ms`, type: "system" },
            ];
            running = false;
            scrollConsole();
        }, 500);
    }

    function clearConsole() {
        consoleLines = [{ text: "Console cleared.", type: "system" }];
    }

    function scrollConsole() {
        requestAnimationFrame(() => {
            if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
        });
    }

    function switchLanguage(lang: "javascript" | "python" | "bash") {
        if (scriptLang === lang) return;
        if (scriptCode.trim() === defaultCode[scriptLang]?.trim() || scriptCode.trim() === "") {
            scriptCode = defaultCode[lang] ?? "";
        }
        scriptLang = lang;
        scheduleSave();
    }

    function addEnvVar() {
        envVars = [...envVars, { key: "", value: "", revealed: false }];
    }

    function removeEnvVar(index: number) {
        envVars = envVars.filter((_, i) => i !== index);
        scheduleSave();
    }

    function toggleReveal(index: number) {
        envVars = envVars.map((v, i) => (i === index ? { ...v, revealed: !v.revealed } : v));
    }

    // ── Lifecycle ───────────────────────────────────────────────────────
    onMount(async () => {
        // Try to load as a gateway tool first
        if (conn.connected) {
            try {
                const report = (await sendRequest('tools.status', {})) as ToolsStatusReport;
                const found = report.tools.find((t) => t.id === toolId);
                if (found) {
                    isGatewayTool = true;
                    gatewayTool = found;
                    name = found.id;
                    description = found.groups.map(g => g.replace('group:', '')).join(', ');
                    status = found.enabled ? 'published' : 'draft';
                    if (found.requires?.env?.length) {
                        envVars = found.requires.env.map(e => ({ key: e, value: '', revealed: false }));
                    }
                    loading = false;
                    return;
                }
            } catch {
                // Not a gateway tool — fall through to builder tool load
            }
        }
        // Load from builder tools API
        try {
            const res = await fetch(`/api/builder/tools/${toolId}`);
            if (res.ok) {
                const data = await res.json();
                const tool = data.tool;
                name = tool.name ?? 'Untitled Tool';
                description = tool.description ?? '';
                scriptCode = tool.scriptCode ?? '// Write your tool script here\n';
                scriptLang = tool.scriptLang ?? 'javascript';
                status = tool.status ?? 'draft';
                // Parse envVars JSON into key/value array
                try {
                    const parsed = JSON.parse(tool.envVars || '{}');
                    envVars = Object.entries(parsed).map(([key, value]) => ({
                        key,
                        value: value as string,
                        revealed: false,
                    }));
                } catch {
                    envVars = [];
                }
            }
        } catch (e) {
            console.error('[tool-editor] Failed to load tool:', e);
        }
        loading = false;
    });

    // ── Auto-save on field changes ──────────────────────────────────────
    $effect(() => {
        void name;
        void description;
        void scriptCode;
        void scriptLang;
        void envVars;
        if (!loading && !isGatewayTool) scheduleSave();
    });
</script>

<div class="page-root">
    <Topbar />

    <!-- Editor Toolbar -->
    <div class="editor-toolbar">
        <div class="toolbar-left">
            <a href="/builder" class="back-link" title="Back to Builder">
                <ArrowLeft size={16} />
            </a>

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
                        placeholder="Tool name"
                        oninput={() => scheduleSave()}
                    />
                {/if}
                <span class="status-badge {status}">
                    {status}
                </span>
                <span class="toolbar-source">{isGatewayTool ? 'gateway' : 'custom'}</span>
            </div>
        </div>

        <div class="toolbar-right">
            {#if isGatewayTool && gatewayTool}
                <!-- Gateway tool: enable/disable toggle (admin only) -->
                {#if isAdmin}
                    <div class="toolbar-divider"></div>
                    <button
                        type="button"
                        class="toolbar-btn {gatewayTool.enabled ? 'published' : 'run'}"
                        onclick={toggleGatewayToolEnabled}
                        title={gatewayTool.enabled ? 'Disable tool' : 'Enable tool'}
                    >
                        {#if gatewayTool.enabled}
                            <PowerOff size={14} />
                            <span class="hidden-sm">Disable</span>
                        {:else}
                            <Power size={14} />
                            <span class="hidden-sm">Enable</span>
                        {/if}
                    </button>
                {/if}
            {:else}
                <!-- Custom builder tool: IDE toolbar -->
                {#if isAdmin}
                    <!-- Language Selector -->
                    <div class="lang-selector">
                        {#each langOptions as lang (lang.id)}
                            <button
                                type="button"
                                class="lang-pill"
                                class:active={scriptLang === lang.id}
                                onclick={() => switchLanguage(lang.id)}
                            >
                                {lang.label}
                            </button>
                        {/each}
                    </div>

                    <div class="toolbar-divider"></div>

                    <!-- Run Button -->
                    <button
                        type="button"
                        class="toolbar-btn run"
                        onclick={runTool}
                        disabled={running}
                        title="Run script"
                    >
                        {#if running}
                            <Loader2 size={14} class="loading-spinner" />
                        {:else}
                            <Play size={14} />
                        {/if}
                        <span class="hidden-sm">Run</span>
                    </button>

                    <div class="toolbar-divider"></div>

                    <!-- Save Indicator -->
                    <span
                        class="save-indicator"
                        title={saving ? "Saving changes..." : dirty ? "Unsaved changes" : "All changes saved"}
                    >
                        {#if saving}
                            <Loader2 size={12} class="loading-spinner" />
                            <span>Saving...</span>
                        {:else if dirty}
                            <Circle size={8} class="dirty-dot" />
                            <span>Unsaved</span>
                        {:else}
                            <Check size={12} class="saved-check" />
                            <span>Saved</span>
                        {/if}
                    </span>

                    <!-- Publish Button -->
                    <button
                        type="button"
                        class="toolbar-btn {status === 'published' ? 'published' : 'primary'}"
                        onclick={publishTool}
                        disabled={publishing}
                        title={status === "published"
                            ? "Republish with latest changes"
                            : "Publish tool"}
                    >
                        {#if publishing}
                            <Loader2 size={14} class="loading-spinner" />
                        {:else}
                            <Upload size={14} />
                        {/if}
                        <span class="hidden-sm"
                            >{publishing
                                ? "Publishing..."
                                : status === "published"
                                    ? "Republish"
                                    : "Publish"}</span
                        >
                    </button>
                {:else}
                    <span class="toolbar-source">{scriptLang}</span>
                {/if}
            {/if}
        </div>
    </div>

    <!-- Main Content Area -->
    {#if loading}
        <div class="loading-container">
            <Loader2 size={24} class="loading-spinner" />
            <span class="loading-text">Loading tool...</span>
        </div>
    {:else if isGatewayTool && gatewayTool}
        <!-- Gateway Tool Detail View -->
        <div class="gateway-detail">
            <div class="gateway-detail-inner">
                <!-- Tool Info Section -->
                <div class="gw-section">
                    <h3 class="gw-section-title">Tool Configuration</h3>
                    <div class="gw-field-grid">
                        <div class="gw-field">
                            <label class="gw-label">Tool ID</label>
                            <span class="gw-value mono">{gatewayTool.id}</span>
                        </div>
                        <div class="gw-field">
                            <label class="gw-label">Status</label>
                            <span class="gw-value">
                                <span class="gw-status-dot {gatewayTool.enabled ? 'enabled' : 'disabled'}"></span>
                                {gatewayTool.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Groups -->
                {#if gatewayTool.groups.length > 0}
                    <div class="gw-section">
                        <h3 class="gw-section-title">Groups</h3>
                        <div class="gw-tags">
                            {#each gatewayTool.groups as group (group)}
                                <span class="gw-tag">{group.replace('group:', '')}</span>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Flags -->
                <div class="gw-section">
                    <h3 class="gw-section-title">Flags</h3>
                    <div class="gw-flags">
                        <div class="gw-flag" class:active={gatewayTool.mcpExport}>
                            <span class="gw-flag-label">MCP Export</span>
                            <span class="gw-flag-value">{gatewayTool.mcpExport ? 'Yes' : 'No'}</span>
                        </div>
                        <div class="gw-flag" class:active={gatewayTool.multi}>
                            <span class="gw-flag-label">Multi-instance</span>
                            <span class="gw-flag-value">{gatewayTool.multi ? 'Yes' : 'No'}</span>
                        </div>
                        <div class="gw-flag" class:active={gatewayTool.optional}>
                            <span class="gw-flag-label">Optional</span>
                            <span class="gw-flag-value">{gatewayTool.optional ? 'Yes' : 'No'}</span>
                        </div>
                    </div>
                </div>

                <!-- Requirements -->
                {#if gatewayTool.requires?.bins?.length || gatewayTool.requires?.env?.length}
                    <div class="gw-section">
                        <h3 class="gw-section-title">Requirements</h3>
                        {#if gatewayTool.requires?.bins?.length}
                            <div class="gw-field">
                                <label class="gw-label">Binaries</label>
                                <div class="gw-tags">
                                    {#each gatewayTool.requires.bins as bin (bin)}
                                        <span class="gw-tag mono">{bin}</span>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                        {#if gatewayTool.requires?.env?.length}
                            <div class="gw-field" style="margin-top: 0.75rem">
                                <label class="gw-label">Environment Variables</label>
                                <div class="gw-tags">
                                    {#each gatewayTool.requires.env as env (env)}
                                        <span class="gw-tag mono">{env}</span>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                {/if}

                <!-- Install Instructions -->
                {#if gatewayTool.install?.length}
                    <div class="gw-section">
                        <h3 class="gw-section-title">Install Instructions</h3>
                        <div class="gw-install-list">
                            {#each gatewayTool.install as inst, i (i)}
                                <div class="gw-install-item">
                                    <span class="gw-install-kind">{inst.label ?? inst.kind}</span>
                                    {#if inst.formula}
                                        <code class="gw-install-cmd">{inst.formula}</code>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Condition -->
                {#if gatewayTool.condition}
                    <div class="gw-section">
                        <h3 class="gw-section-title">Condition</h3>
                        <code class="gw-condition">{gatewayTool.condition}</code>
                    </div>
                {/if}

                <!-- Toggle Button (admin only) -->
                {#if isAdmin}
                    <div class="gw-section">
                        <button
                            type="button"
                            class="gw-toggle-btn {gatewayTool.enabled ? 'disable' : 'enable'}"
                            onclick={toggleGatewayToolEnabled}
                        >
                            {#if gatewayTool.enabled}
                                <PowerOff size={16} />
                                <span>Disable Tool</span>
                            {:else}
                                <Power size={16} />
                                <span>Enable Tool</span>
                            {/if}
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    {:else}
        <!-- Custom Builder Tool IDE -->
        <div class="ide-split">
            <!-- Left Pane: Code Editor + Env Vars -->
            <div class="pane-left">
                <div class="editor-area">
                    <textarea
                        class="code-textarea"
                        bind:value={scriptCode}
                        spellcheck="false"
                        autocomplete="off"
                        autocorrect="off"
                        autocapitalize="off"
                        placeholder={defaultCode[scriptLang]}
                        readonly={!isAdmin}
                    ></textarea>
                </div>

                <!-- Env Vars Panel -->
                <div class="env-panel" class:collapsed={!envVarsExpanded}>
                    <button
                        type="button"
                        class="env-header"
                        onclick={() => {
                            envVarsExpanded = !envVarsExpanded;
                        }}
                    >
                        <span class="env-header-left">
                            {#if envVarsExpanded}
                                <ChevronDown size={14} />
                            {:else}
                                <ChevronRight size={14} />
                            {/if}
                            <span>Environment Variables</span>
                            <span class="env-count">{envVars.length}</span>
                        </span>
                    </button>

                    {#if envVarsExpanded}
                        <div class="env-body">
                            {#each envVars as envVar, i (i)}
                                <div class="env-row">
                                    <input
                                        type="text"
                                        class="env-key"
                                        bind:value={envVar.key}
                                        placeholder="KEY"
                                        oninput={() => scheduleSave()}
                                    />
                                    <span class="env-eq">=</span>
                                    <div class="env-value-wrap">
                                        {#if envVar.revealed}
                                            <input
                                                type="text"
                                                class="env-value"
                                                bind:value={envVar.value}
                                                placeholder="value"
                                                oninput={() => scheduleSave()}
                                            />
                                        {:else}
                                            <input
                                                type="password"
                                                class="env-value"
                                                bind:value={envVar.value}
                                                placeholder="value"
                                                oninput={() => scheduleSave()}
                                            />
                                        {/if}
                                        <button
                                            type="button"
                                            class="env-reveal"
                                            onclick={() => toggleReveal(i)}
                                            title={envVar.revealed ? "Hide value" : "Reveal value"}
                                        >
                                            {#if envVar.revealed}
                                                <EyeOff size={12} />
                                            {:else}
                                                <Eye size={12} />
                                            {/if}
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        class="env-remove"
                                        onclick={() => removeEnvVar(i)}
                                        title="Remove variable"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            {/each}
                            <button type="button" class="env-add" onclick={addEnvVar}>
                                <Plus size={12} />
                                <span>Add Variable</span>
                            </button>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Split Divider -->
            <div class="split-divider"></div>

            <!-- Right Pane: Console -->
            <div class="pane-right">
                <div class="console-header">
                    <span class="console-title">
                        <Terminal size={14} />
                        <span>Console</span>
                    </span>
                    <button
                        type="button"
                        class="console-clear"
                        onclick={clearConsole}
                        title="Clear console"
                    >
                        <X size={12} />
                        <span>Clear</span>
                    </button>
                </div>
                <div class="console-output" bind:this={consoleEl}>
                    {#each consoleLines as line, i (i)}
                        <div class="console-line {line.type}">{line.text}</div>
                    {/each}
                    {#if running}
                        <div class="console-line system console-cursor">_</div>
                    {/if}
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    /* ── Page Root ────────────────────────────────────────────────────── */
    .page-root {
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
        color: var(--color-foreground);
        position: relative;
        z-index: 10;
    }

    /* ── Editor Toolbar ──────────────────────────────────────────────── */
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 2.75rem;
        padding: 0 0.75rem;
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: 0.5rem;
    }

    .toolbar-left {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }

    .toolbar-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
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
        border-radius: 0.375rem;
        color: var(--color-muted);
        transition: all 0.15s ease;
        flex-shrink: 0;
    }

    .back-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .toolbar-identity {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }

    :global(.tool-icon) {
        color: var(--color-accent);
        flex-shrink: 0;
    }

    .name-inline {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 1px solid transparent;
        padding: 0.125rem 0;
        outline: none;
        font-family: inherit;
        min-width: 6rem;
        max-width: 16rem;
        transition: border-color 0.15s ease;
    }

    .name-inline:focus {
        border-bottom-color: var(--color-accent);
    }

    .name-inline::placeholder {
        color: var(--color-muted);
    }

    .name-inline-ro {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        padding: 0.125rem 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 16rem;
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.625rem;
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
        gap: 0.125rem;
        padding: 0.125rem;
        border-radius: 0.375rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
    }

    .lang-pill {
        display: flex;
        align-items: center;
        padding: 0.1875rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.6875rem;
        font-weight: 500;
        color: var(--color-muted);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        white-space: nowrap;
    }

    .lang-pill:hover {
        color: var(--color-foreground);
    }

    .lang-pill.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent);
    }

    /* ── Toolbar Buttons ─────────────────────────────────────────────── */
    .toolbar-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.625rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
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
        gap: 0.3125rem;
        font-size: 0.6875rem;
        color: var(--color-muted);
        white-space: nowrap;
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        user-select: none;
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    :global(.dirty-dot) {
        color: var(--color-warning, #f59e0b);
        fill: var(--color-warning, #f59e0b);
    }

    :global(.saved-check) {
        color: var(--color-success, #22c55e);
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    /* ── Loading ──────────────────────────────────────────────────────── */
    .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        flex: 1;
    }

    .loading-text {
        font-size: 0.8125rem;
        color: var(--color-muted);
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

    /* ── IDE Split Layout ────────────────────────────────────────────── */
    .ide-split {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .pane-left {
        display: flex;
        flex-direction: column;
        width: 60%;
        min-width: 0;
        min-height: 0;
    }

    .split-divider {
        width: 1px;
        background: var(--color-border);
        flex-shrink: 0;
        position: relative;
        box-shadow: 0 0 8px color-mix(in srgb, var(--color-accent) 8%, transparent);
    }

    .pane-right {
        display: flex;
        flex-direction: column;
        width: 40%;
        min-width: 0;
        min-height: 0;
    }

    /* ── Editor Area ─────────────────────────────────────────────────── */
    .editor-area {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
    }

    .code-textarea {
        width: 100%;
        height: 100%;
        resize: none;
        border: none;
        outline: none;
        padding: 1rem 1.25rem;
        font-family: "SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", monospace;
        font-size: 0.8125rem;
        line-height: 1.7;
        tab-size: 4;
        color: var(--color-foreground);
        background: color-mix(in srgb, var(--color-bg) 85%, black);
        caret-color: var(--color-accent);
    }

    .code-textarea::placeholder {
        color: var(--color-muted);
        opacity: 0.5;
    }

    .code-textarea:focus {
        box-shadow: inset 0 0 0 1px
            color-mix(in srgb, var(--color-success, #22c55e) 25%, transparent);
    }

    /* ── Env Vars Panel ──────────────────────────────────────────────── */
    .env-panel {
        flex-shrink: 0;
        border-top: 1px solid var(--color-border);
        background: var(--color-bg2);
    }

    .env-panel:not(.collapsed) {
        height: 200px;
        display: flex;
        flex-direction: column;
    }

    .env-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        background: none;
        border: none;
        cursor: pointer;
        width: 100%;
        color: var(--color-muted);
        font-family: inherit;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        transition: color 0.15s ease;
    }

    .env-header:hover {
        color: var(--color-foreground);
    }

    .env-header-left {
        display: flex;
        align-items: center;
        gap: 0.375rem;
    }

    .env-count {
        font-size: 0.5625rem;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 9999px;
        font-weight: 500;
    }

    .env-body {
        flex: 1;
        overflow-y: auto;
        padding: 0 0.75rem 0.625rem;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .env-row {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.5rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.375rem;
    }

    .env-key {
        width: 8rem;
        font-size: 0.75rem;
        font-weight: 600;
        font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        outline: none;
        padding: 0.125rem 0;
        text-transform: uppercase;
    }

    .env-key::placeholder {
        color: var(--color-muted);
        text-transform: uppercase;
    }

    .env-eq {
        font-size: 0.75rem;
        color: var(--color-muted);
        font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
        flex-shrink: 0;
    }

    .env-value-wrap {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 0.25rem;
        min-width: 0;
    }

    .env-value {
        flex: 1;
        font-size: 0.75rem;
        font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        outline: none;
        padding: 0.125rem 0;
        min-width: 0;
    }

    .env-value::placeholder {
        color: var(--color-muted);
    }

    .env-reveal {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 0.25rem;
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        transition: color 0.1s ease;
    }

    .env-reveal:hover {
        color: var(--color-foreground);
    }

    .env-remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 0.25rem;
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        transition: all 0.1s ease;
        opacity: 0.5;
    }

    .env-row:hover .env-remove {
        opacity: 1;
    }

    .env-remove:hover {
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 12%, transparent);
    }

    .env-add {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.625rem;
        border: 1px dashed var(--color-border);
        border-radius: 0.375rem;
        background: transparent;
        color: var(--color-muted);
        font-size: 0.6875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .env-add:hover {
        border-color: var(--color-accent);
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 4%, transparent);
    }

    /* ── Console ──────────────────────────────────────────────────────── */
    .console-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg2);
        flex-shrink: 0;
    }

    .console-title {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
    }

    .console-clear {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.1875rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.625rem;
        font-weight: 500;
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        transition: all 0.1s ease;
        font-family: inherit;
    }

    .console-clear:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .console-output {
        flex: 1;
        overflow-y: auto;
        padding: 0.75rem;
        background: color-mix(in srgb, var(--color-bg) 75%, black);
        font-family: "SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", monospace;
        font-size: 0.75rem;
        line-height: 1.6;
    }

    .console-line {
        white-space: pre-wrap;
        word-break: break-all;
    }

    .console-line.stdout {
        color: var(--color-success, #22c55e);
    }

    .console-line.stderr {
        color: var(--color-error, #ef4444);
    }

    .console-line.system {
        color: var(--color-muted);
        font-style: italic;
    }

    .console-cursor {
        animation: blink 1s step-end infinite;
    }

    @keyframes blink {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0;
        }
    }

    /* ── Toolbar Source Label ──────────────────────────────────────── */
    .toolbar-source {
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.1875rem 0.5rem;
        border-radius: 0.25rem;
        border: 1px solid var(--color-border);
        font-family: var(--font-mono, monospace);
    }

    /* ── Gateway Tool Detail View ─────────────────────────────────── */
    .gateway-detail {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 2rem;
    }

    .gateway-detail-inner {
        max-width: 640px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .gw-section {
        padding: 1rem 1.25rem;
        border: 1px solid var(--color-border);
        border-radius: 0.625rem;
        background: var(--color-bg2);
    }

    .gw-section-title {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-muted);
        margin: 0 0 0.75rem;
    }

    .gw-field-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
    }

    .gw-field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .gw-label {
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-muted);
    }

    .gw-value {
        font-size: 0.8125rem;
        color: var(--color-foreground);
        display: flex;
        align-items: center;
        gap: 0.375rem;
    }

    .gw-value.mono, .mono {
        font-family: var(--font-mono, monospace);
    }

    .gw-status-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .gw-status-dot.enabled {
        background: var(--color-success, #22c55e);
        box-shadow: 0 0 6px color-mix(in srgb, var(--color-success, #22c55e) 50%, transparent);
    }

    .gw-status-dot.disabled {
        background: var(--color-muted);
    }

    .gw-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
    }

    .gw-tag {
        font-size: 0.6875rem;
        padding: 0.1875rem 0.5rem;
        border-radius: 0.375rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        color: var(--color-foreground);
    }

    .gw-tag.mono {
        font-family: var(--font-mono, monospace);
    }

    .gw-flags {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
    }

    .gw-flag {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        padding: 0.625rem;
        border-radius: 0.5rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        opacity: 0.5;
    }

    .gw-flag.active {
        opacity: 1;
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
        background: color-mix(in srgb, var(--color-accent) 6%, var(--color-bg3));
    }

    .gw-flag-label {
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-muted);
    }

    .gw-flag-value {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--color-foreground);
    }

    .gw-install-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .gw-install-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-radius: 0.375rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
    }

    .gw-install-kind {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--color-muted);
        min-width: 4rem;
    }

    .gw-install-cmd {
        font-size: 0.75rem;
        font-family: var(--font-mono, monospace);
        color: var(--color-accent);
    }

    .gw-condition {
        display: block;
        font-size: 0.75rem;
        font-family: var(--font-mono, monospace);
        color: var(--color-foreground);
        padding: 0.5rem 0.75rem;
        border-radius: 0.375rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
    }

    .gw-toggle-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.625rem;
        border-radius: 0.5rem;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        border: none;
    }

    .gw-toggle-btn.enable {
        color: var(--color-success, #22c55e);
        background: color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent);
    }

    .gw-toggle-btn.enable:hover {
        background: color-mix(in srgb, var(--color-success, #22c55e) 20%, transparent);
    }

    .gw-toggle-btn.disable {
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
    }

    .gw-toggle-btn.disable:hover {
        background: color-mix(in srgb, var(--color-error, #ef4444) 15%, transparent);
    }
</style>
