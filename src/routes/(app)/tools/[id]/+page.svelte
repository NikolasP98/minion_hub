<script lang="ts">
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { createDebouncer } from '$lib/pacer/index.svelte';
  import { isAdmin as hubIsAdmin } from '$lib/state/features/user.svelte';
  import type { ToolStatusEntry, ToolsStatusReport } from '$lib/types/tools';
  import * as m from '$lib/paraglide/messages';
  import EditorToolbar from './_components/EditorToolbar.svelte';
  import GatewayToolView from './_components/GatewayToolView.svelte';
  import CodeEditorPane from './_components/CodeEditorPane.svelte';
  import ConsolePane from './_components/ConsolePane.svelte';
  import { Button } from '$lib/components/ui';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import { fetchJson } from '$lib/api/fetch-json';

  const isAdmin = $derived(hubIsAdmin.value);

  const toolId = $derived(page.params.id);

  // ── Mode: gateway tool vs custom builder tool ───────────────────────
  let isGatewayTool = $state(false);
  let gatewayTool = $state<ToolStatusEntry | null>(null);
  // Resolution bookkeeping: the builder API and the gateway are checked
  // independently (the WS may connect long after mount on a direct page
  // load); only when BOTH come back empty is the tool truly not found.
  let resolved = $state(false);
  let notFound = $state(false);
  let builderChecked = $state(false);
  let gatewayChecked = $state(false);

  // ── Form state ──────────────────────────────────────────────────────
  let name = $state('Untitled Tool');
  let description = $state('');
  let scriptCode = $state('');
  let scriptLang = $state<'javascript' | 'python' | 'bash'>('javascript');
  let envVars = $state<Array<{ key: string; value: string; revealed: boolean }>>([]);
  let status = $state<'draft' | 'published'>('draft');
  let loading = $state(true);
  let saving = $state(false);
  let dirty = $state(false);
  let publishing = $state(false);
  let operationError = $state<string | null>(null);
  const autoSave = createDebouncer(() => saveTool(), { wait: 2000 });

  // ── Permission (module + action) ────────────────────────────────────
  // Stored inside builtTools.executionConfig JSON under `permission` — no
  // dedicated column exists, and this JSON blob already round-trips through
  // the PUT save path, so reuse it rather than adding a migration.
  let executionConfigRaw = $state<Record<string, unknown>>({});
  let permModule = $state('');
  let permAction = $state<'view' | 'create' | 'edit' | 'delete' | 'export' | 'manage'>('view');

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
  let consoleLines = $state<Array<{ text: string; type: 'stdout' | 'stderr' | 'system' }>>([
    { text: 'Ready. Click Run to execute.', type: 'system' },
  ]);
  let running = $state(false);

  // ── Env vars panel ──────────────────────────────────────────────────
  let envVarsExpanded = $state(true);

  // ── Console element ref ─────────────────────────────────────────────
  let consoleEl: HTMLDivElement | undefined = $state(undefined);

  // ── Language options ────────────────────────────────────────────────
  const langOptions: Array<{ id: 'javascript' | 'python' | 'bash'; label: string }> = [
    { id: 'javascript', label: 'JS' },
    { id: 'python', label: 'Python' },
    { id: 'bash', label: 'Bash' },
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
    operationError = null;
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
      await fetchJson<{ ok: boolean }>(`/api/builder/tools/${toolId}`, {
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
      dirty = false;
    } catch (e) {
      console.error('[tool-editor] Save failed:', e);
      operationError = e instanceof Error ? e.message : m.common_error();
    } finally {
      saving = false;
    }
  }

  async function publishTool() {
    if (dirty) await saveTool();
    if (dirty) return;
    publishing = true;
    operationError = null;
    try {
      await fetchJson<{ ok: boolean }>(`/api/builder/tools/${toolId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      status = 'published';
      // Nudge the gateway to pick the tool up on its next turn. Fire-and-forget:
      // a stale local gateway (pre-restart) may not know this RPC yet — that's fine,
      // the gateway's own TTL-based custom-tools poll will catch it either way.
      sendRequest('tools.reload').catch(() => {});
    } catch (e) {
      console.error('[tool-editor] Publish failed:', e);
      operationError = e instanceof Error ? e.message : m.common_error();
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
      console.error('[tool-editor] Toggle failed:', e);
      operationError = e instanceof Error ? e.message : m.common_error();
    }
  }

  // ponytail: ring buffer, virtualize if anyone needs full-run logs
  function appendConsole(...lines: Array<{ text: string; type: 'stdout' | 'stderr' | 'system' }>) {
    consoleLines = [...consoleLines, ...lines].slice(-500);
  }

  async function runTool() {
    if (running) return;
    running = true;
    const now = new Date().toLocaleTimeString();
    appendConsole({
      text: `[${now}] ${m.tools_editor_runningScript({ lang: scriptLang })}`,
      type: 'system',
    });
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
      )) as {
        output: Array<{ stream: 'stdout' | 'stderr'; line: string }>;
        exitCode: number;
        durationMs: number;
      };

      for (const line of result.output) {
        appendConsole({ text: line.line, type: line.stream });
      }
      appendConsole({
        text: `[exit ${result.exitCode}] duration: ${result.durationMs}ms`,
        type: result.exitCode === 0 ? 'system' : 'stderr',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendConsole({ text: m.tools_editor_runFailed({ error: msg }), type: 'stderr' });
    } finally {
      running = false;
      scrollConsole();
    }
  }

  function clearConsole() {
    consoleLines = [{ text: 'Console cleared.', type: 'system' }];
  }

  function scrollConsole() {
    requestAnimationFrame(() => {
      if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
    });
  }

  function switchLanguage(lang: 'javascript' | 'python' | 'bash') {
    if (scriptLang === lang) return;
    if (scriptCode.trim() === defaultCode[scriptLang]?.trim() || scriptCode.trim() === '') {
      scriptCode = defaultCode[lang] ?? '';
    }
    scriptLang = lang;
    scheduleSave();
  }

  function addEnvVar() {
    envVars = [...envVars, { key: '', value: '', revealed: false }];
  }

  function removeEnvVar(index: number) {
    envVars = envVars.filter((_, i) => i !== index);
    scheduleSave();
  }

  function toggleReveal(index: number) {
    envVars = envVars.map((v, i) => (i === index ? { ...v, revealed: !v.revealed } : v));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────
  function maybeFinishResolution() {
    if (resolved) return;
    if (builderChecked && gatewayChecked) {
      notFound = true;
      loading = false;
    }
  }

  async function loadGatewayTool() {
    try {
      const report = (await sendRequest('tools.status', {})) as ToolsStatusReport;
      if (resolved) return;
      const found = report.tools.find((t) => t.id === toolId);
      if (found) {
        resolved = true;
        isGatewayTool = true;
        gatewayTool = found;
        name = found.id;
        description = found.groups.map((g) => g.replace('group:', '')).join(', ');
        status = found.enabled ? 'published' : 'draft';
        if (found.requires?.env?.length) {
          envVars = found.requires.env.map((e) => ({ key: e, value: '', revealed: false }));
        }
        loading = false;
        return;
      }
    } catch {
      // Gateway unreachable or RPC failed — treat as "not a gateway tool".
    }
    gatewayChecked = true;
    maybeFinishResolution();
  }

  async function loadBuilderTool() {
    try {
      const res = await fetch(`/api/builder/tools/${toolId}`);
      if (res.ok) {
        const data = await res.json();
        const tool = data.tool;
        if (resolved) return;
        resolved = true;
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
            { module?: string; action?: string } | undefined;
          if (perm?.module) {
            permModule = perm.module;
            permAction = (perm.action as typeof permAction) ?? 'view';
          }
        } catch {
          executionConfigRaw = {};
        }
        loading = false;
        return;
      }
    } catch (e) {
      console.error('[tool-editor] Failed to load tool:', e);
    }
    builderChecked = true;
    maybeFinishResolution();
  }

  onMount(() => {
    void loadBuilderTool();
  });

  // Gateway detection re-arms whenever the WS (re)connects — on a direct
  // page load the socket is rarely up during onMount, which previously left
  // native tools rendering as a phantom "Untitled Tool" draft.
  let gatewayProbeStarted = false;
  $effect(() => {
    if (conn.connected && !resolved && !gatewayProbeStarted) {
      gatewayProbeStarted = true;
      void loadGatewayTool();
    }
  });

  // Reference variables for the System/Module/Database tabs — fetched once,
  // independent of the gateway-vs-custom tool branch above.
  onMount(() => {
    fetch('/api/builder/tools/variables')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        variablesData = d;
      })
      .catch(() => {});
    fetch('/api/builder/tools/schema-catalog')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        schemaCatalog = d;
      })
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
    if (!loading && !isGatewayTool && !notFound) scheduleSave();
  });
</script>

<div class="tool-editor-page">
  {#if loading || notFound}
    <!-- Minimal header: never show the editable "Untitled Tool" draft chrome
         for a tool that hasn't resolved (or doesn't exist). -->
    <div class="pending-bar">
      <a href="/capabilities?tab=tools" class="pending-back" aria-label={m.common_back()}>←</a>
      <span class="pending-title">{notFound ? toolId : m.builder_loadingTool()}</span>
    </div>
  {:else}
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
  {/if}

  {#if operationError}
    <p class="operation-error" role="alert">{operationError}</p>
  {/if}

  <!-- Main Content Area -->
  <AsyncBoundary
    state={loading
      ? {
          kind: 'loading',
          label:
            builderChecked && !conn.connected ? m.tools_waitingGateway() : m.builder_loadingTool(),
        }
      : notFound
        ? {
            kind: 'empty',
            title: m.tools_notFound(),
            description: m.tools_notFoundHint({ id: toolId ?? '' }),
          }
        : { kind: 'ready' }}
    class="tool-boundary"
  >
    {#snippet emptyAction()}
      <Button href="/capabilities?tab=tools" variant="secondary" size="sm">
        {m.tools_backToCapabilities()}
      </Button>
    {/snippet}
    {#if isGatewayTool && gatewayTool}
      <GatewayToolView
        {gatewayTool}
        {isAdmin}
        onToggleGatewayToolEnabled={toggleGatewayToolEnabled}
      />
    {:else}
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
          onToggleExpanded={() => {
            envVarsExpanded = !envVarsExpanded;
          }}
        />

        <div class="split-divider"></div>

        <ConsolePane {consoleLines} {running} bind:consoleEl onClearConsole={clearConsole} />
      </div>
    {/if}
  </AsyncBoundary>
</div>

<style>
  .tool-editor-page {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
  }

  .pending-bar {
    display: flex;
    min-height: var(--control-height-touch);
    padding: var(--space-1) var(--space-3);
    align-items: center;
    gap: var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
  }

  .pending-back {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-compact);
    text-decoration: none;
  }

  .pending-back:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-2);
  }

  .pending-title {
    color: var(--color-text-secondary);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-mono);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
  }

  .operation-error {
    margin: var(--space-2) var(--space-3) 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  :global(.tool-boundary) {
    display: flex;
    min-height: 0;
    flex: 1;
  }

  .ide-split {
    display: flex;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }

  .split-divider {
    position: relative;
    width: 1px;
    flex-shrink: 0;
    background: var(--color-border-default);
    box-shadow: var(--shadow-elevation-1);
  }

  @media (max-width: 767.98px) {
    .ide-split {
      flex-direction: column;
    }

    .split-divider {
      width: 100%;
      height: 1px;
    }

    :global(.ide-split .pane-left),
    :global(.ide-split .pane-right) {
      width: 100%;
      height: 50%;
    }
  }
</style>
