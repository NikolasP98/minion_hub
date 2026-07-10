<script lang="ts">
    import { page } from "$app/state";
    import { Loader2 } from "lucide-svelte";
    import { onMount, onDestroy } from "svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import { createDebouncer } from "$lib/pacer/index.svelte";
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
    let scriptCode = $state("");
    let scriptLang = $state<"javascript" | "python" | "bash">("javascript");
    let envVars = $state<Array<{ key: string; value: string; revealed: boolean }>>([]);
    let status = $state<"draft" | "published">("draft");
    let loading = $state(true);
    let saving = $state(false);
    let dirty = $state(false);
    let publishing = $state(false);
    const autoSave = createDebouncer(() => saveTool(), { wait: 2000 });

    // ── Permission (module + action) ────────────────────────────────────
    // Stored inside builtTools.executionConfig JSON under `permission` — no
    // dedicated column exists, and this JSON blob already round-trips through
    // the PUT save path, so reuse it rather than adding a migration.
    let executionConfigRaw = $state<Record<string, unknown>>({});
    let permModule = $state("");
    let permAction = $state<"view" | "create" | "edit" | "delete" | "export" | "manage">("view");

    // ── Reference variables (System/Module/Database tabs) ───────────────
    let variablesData = $state<{
        system: Array<{ key: string; description: string }>;
        module: Array<{ key: string; path: string; description: string }>;
        database: Array<{ key: string; value: string; description: string }>;
    } | null>(null);

    // ── Schema catalog (DB tables/columns) for editor intellisense + Queries
    // tab. WP-8 lands the endpoint (C11); degrade to empty tables until then.
    let schemaCatalog = $state<{
        tables: Array<{ name: string; columns: Array<{ name: string; type: string }> }>;
    } | null>(null);

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
        javascript: `// MINION custom tool. Input arrives as MINION_TOOL_INPUT (JSON or text).
// Available env vars: MINION_AGENT_ID, MINION_ORG_ID, MINION_USER_ID,
// MINION_GATEWAY_URL, MINION_HUB_URL, MINION_TOOL_ID, MINION_TOOL_NAME
// (see the System / Module / Database Vars tabs below for the full list).

const input = process.env.MINION_TOOL_INPUT ?? '';
const result = { ok: true, input };

console.log(JSON.stringify(result));
`,
        python: `# MINION custom tool. Input arrives as MINION_TOOL_INPUT (JSON or text).
# Available env vars: MINION_AGENT_ID, MINION_ORG_ID, MINION_USER_ID,
# MINION_GATEWAY_URL, MINION_HUB_URL, MINION_TOOL_ID, MINION_TOOL_NAME
# (see the System / Module / Database Vars tabs below for the full list).
import os, json

tool_input = os.environ.get('MINION_TOOL_INPUT', '')
result = {"ok": True, "input": tool_input}

print(json.dumps(result))
`,
        bash: `#!/bin/bash
# MINION custom tool. Input arrives as $MINION_TOOL_INPUT (JSON or text).
# Available env vars: MINION_AGENT_ID, MINION_ORG_ID, MINION_USER_ID,
# MINION_GATEWAY_URL, MINION_HUB_URL, MINION_TOOL_ID, MINION_TOOL_NAME
# (see the System / Module / Database Vars tabs below for the full list).

echo "{\\"ok\\": true, \\"input\\": \\"\${MINION_TOOL_INPUT}\\"}"
`,
    };

    // ── Actions ─────────────────────────────────────────────────────────
    function scheduleSave() {
        if (isGatewayTool) return;
        dirty = true;
        autoSave.run();
    }

    async function saveTool() {
        saving = true;
        try {
            const envObj: Record<string, string> = {};
            for (const v of envVars) {
                if (v.key) envObj[v.key] = v.value;
            }
            const executionConfig = { ...executionConfigRaw };
            if (permModule) {
                executionConfig.permission = { module: permModule, action: permAction };
            } else {
                delete executionConfig.permission;
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
                    executionConfig: JSON.stringify(executionConfig),
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
            // Nudge the gateway to pick the tool up on its next turn. Fire-and-forget:
            // a stale local gateway (pre-restart) may not know this RPC yet — that's fine,
            // the gateway's own TTL-based custom-tools poll will catch it either way.
            sendRequest('tools.reload').catch(() => {});
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

    async function runTool() {
        if (running) return;
        running = true;
        const now = new Date().toLocaleTimeString();
        appendConsole({ text: `[${now}] ${m.tools_editor_runningScript({ lang: scriptLang })}`, type: "system" });
        scrollConsole();

        try {
            const envObj: Record<string, string> = {};
            for (const v of envVars) {
                if (v.key) envObj[v.key] = v.value;
            }
            const result = (await sendRequest(
                'tools.custom.run',
                { lang: scriptLang, script: scriptCode, env: envObj, timeoutMs: 30000 },
                45000,
            )) as { output: Array<{ stream: "stdout" | "stderr"; line: string }>; exitCode: number; durationMs: number };

            for (const line of result.output) {
                appendConsole({ text: line.line, type: line.stream });
            }
            appendConsole({
                text: `[exit ${result.exitCode}] duration: ${result.durationMs}ms`,
                type: result.exitCode === 0 ? "system" : "stderr",
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            appendConsole({ text: m.tools_editor_runFailed({ error: msg }), type: "stderr" });
        } finally {
            running = false;
            scrollConsole();
        }
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
                scriptLang = tool.scriptLang ?? 'javascript';
                scriptCode = tool.scriptCode ?? defaultCode[scriptLang];
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
                // Parse executionConfig JSON — preserve unknown keys, pull out `permission`.
                try {
                    executionConfigRaw = JSON.parse(tool.executionConfig || '{}');
                    const perm = executionConfigRaw.permission as
                        | { module?: string; action?: string }
                        | undefined;
                    if (perm?.module) {
                        permModule = perm.module;
                        permAction = (perm.action as typeof permAction) ?? 'view';
                    }
                } catch {
                    executionConfigRaw = {};
                }
            }
        } catch (e) {
            console.error('[tool-editor] Failed to load tool:', e);
        }
        loading = false;
    });

    // Reference variables for the System/Module/Database tabs — fetched once,
    // independent of the gateway-vs-custom tool branch above.
    onMount(() => {
        fetch('/api/builder/tools/variables')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { variablesData = d; })
            .catch(() => {});
        fetch('/api/builder/tools/schema-catalog')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { schemaCatalog = d; })
            .catch(() => {});
    });
    onDestroy(() => autoSave.flush());

    // ── Auto-save on field changes ──────────────────────────────────────
    $effect(() => {
        void name;
        void description;
        void scriptCode;
        void scriptLang;
        void envVars;
        void permModule;
        void permAction;
        if (!loading && !isGatewayTool) scheduleSave();
    });
</script>

<div class="tool-editor-page">
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
    bind:permModule
    bind:permAction
    onNameInput={scheduleSave}
    onSwitchLanguage={switchLanguage}
    onRunTool={runTool}
    onPublishTool={publishTool}
    onToggleGatewayToolEnabled={toggleGatewayToolEnabled}
    onPermChange={scheduleSave}
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
            {variablesData}
            {schemaCatalog}
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
</div>

<style>
    /* ── Page wrapper ────────────────────────────────────────────────────
       The (app) layout wraps every page in a plain (non-flex) `.h-full` div,
       so a bare `flex:1` on `.ide-split` had no flex-column ancestor to grow
       inside — the editor collapsed to its content height and the whole
       document scrolled. This wrapper re-establishes the flex column locally
       (toolbar + body fill the viewport, body panes stretch, no page scroll). */
    .tool-editor-page {
        height: 100%;
        display: flex;
        flex-direction: column;
        min-height: 0;
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
