<script lang="ts">
    import { page } from "$app/state";
    import { Loader2 } from "lucide-svelte";
    import { onMount } from "svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import { createAutoSave } from "$lib/state/async.svelte";
    import { isAdmin as hubIsAdmin } from "$lib/state/features/user.svelte";
    import type { ToolStatusEntry, ToolsStatusReport } from "$lib/types/tools";
    import * as m from '$lib/paraglide/messages';
    import EditorToolbar from "./_components/EditorToolbar.svelte";
    import GatewayToolView from "./_components/GatewayToolView.svelte";
    import CodeEditorPane from "./_components/CodeEditorPane.svelte";
    import ConsolePane from "./_components/ConsolePane.svelte";

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
    const autoSave = createAutoSave(() => saveTool(), 2000);

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
        autoSave.schedule();
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

    // ponytail: ring buffer, virtualize if anyone needs full-run logs
    function appendConsole(...lines: Array<{ text: string; type: "stdout" | "stderr" | "system" }>) {
        consoleLines = [...consoleLines, ...lines].slice(-500);
    }

    function runTool() {
        if (running) return;
        running = true;
        const now = new Date().toLocaleTimeString();
        appendConsole({ text: `[${now}] Running ${scriptLang} script...`, type: "system" });
        scrollConsole();

        // Simulate: not connected yet
        setTimeout(() => {
            appendConsole(
                { text: "Execution not yet connected to gateway.", type: "stderr" },
                { text: `[exit 1] duration: 0ms`, type: "system" },
            );
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

<EditorToolbar
    {isAdmin}
    {isGatewayTool}
    {gatewayTool}
    bind:name
    {status}
    {scriptLang}
    {langOptions}
    {saving}
    {dirty}
    {running}
    {publishing}
    onNameInput={scheduleSave}
    onSwitchLanguage={switchLanguage}
    onRunTool={runTool}
    onPublishTool={publishTool}
    onToggleGatewayToolEnabled={toggleGatewayToolEnabled}
/>

<!-- Main Content Area -->
{#if loading}
    <div class="loading-container">
        <Loader2 size={24} class="loading-spinner" />
        <span class="loading-text">{m.builder_loadingTool()}</span>
    </div>
{:else if isGatewayTool && gatewayTool}
    <GatewayToolView {gatewayTool} {isAdmin} onToggleGatewayToolEnabled={toggleGatewayToolEnabled} />
{:else}
    <!-- Custom Builder Tool IDE -->
    <div class="ide-split">
        <CodeEditorPane
            bind:scriptCode
            {scriptLang}
            {defaultCode}
            bind:envVars
            {envVarsExpanded}
            {isAdmin}
            onCodeChange={scheduleSave}
            onAddEnvVar={addEnvVar}
            onRemoveEnvVar={removeEnvVar}
            onToggleReveal={toggleReveal}
            onToggleExpanded={() => { envVarsExpanded = !envVarsExpanded; }}
        />

        <!-- Split Divider -->
        <div class="split-divider"></div>

        <ConsolePane
            {consoleLines}
            {running}
            bind:consoleEl
            onClearConsole={clearConsole}
        />
    </div>
{/if}

<style>
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

    /* ── IDE Split Layout ────────────────────────────────────────────── */
    .ide-split {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .split-divider {
        width: 1px;
        background: var(--color-border);
        flex-shrink: 0;
        position: relative;
        box-shadow: 0 0 8px color-mix(in srgb, var(--color-accent) 8%, transparent);
    }
</style>
