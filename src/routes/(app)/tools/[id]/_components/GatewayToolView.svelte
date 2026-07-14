<script lang="ts">
    import { onMount } from "svelte";
    import { Power, PowerOff, Loader2, Code2 } from "lucide-svelte";
    import type { ToolStatusEntry } from "$lib/types/tools";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import * as m from '$lib/paraglide/messages';
    import CodeMirrorEditor from "./CodeMirrorEditor.svelte";

    interface Props {
        gatewayTool: ToolStatusEntry;
        isAdmin: boolean;
        onToggleGatewayToolEnabled: () => void;
    }

    let { gatewayTool, isAdmin, onToggleGatewayToolEnabled }: Props = $props();

    // ── Read-only source view (tools.inspect) ──────────────────────────
    // The gateway stringifies the tool's factory from the shipped bundle —
    // exactly what runs in production. Older gateways lack the RPC; render
    // an honest interface stub from tools.status meta instead, so the IDE
    // pane always shows something useful.
    let source = $state<string | null>(null);
    let sourceState = $state<"loading" | "ready" | "stub">("loading");

    function pascal(id: string): string {
        return id.split(/[_-]/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join("");
    }

    function stubSource(t: ToolStatusEntry): string {
        const pad = (k: string) => k.padEnd(12);
        const meta: string[] = [];
        if (t.groups.length) meta.push(`// ${pad("groups:")}${t.groups.map((g) => g.replace("group:", "")).join(", ")}`);
        if (t.condition) meta.push(`// ${pad("condition:")}${t.condition}`);
        if (t.permission) meta.push(`// ${pad("permission:")}${t.permission.module}.${t.permission.action}`);
        if (t.requires?.env?.length) meta.push(`// ${pad("env:")}${t.requires.env.join(", ")}`);
        if (t.requires?.bins?.length) meta.push(`// ${pad("binaries:")}${t.requires.bins.join(", ")}`);
        if (t.mcpExport) meta.push(`// ${pad("mcp:")}exported`);
        return [
            `// ${t.display?.emoji ? t.display.emoji + " " : ""}${t.display?.title ?? t.id} — native gateway tool`,
            `//`,
            ...(meta.length ? [...meta, `//`] : []),
            `// This tool is compiled into the gateway binary. The connected gateway`,
            `// predates the tools.inspect RPC, so its bundled source can't be shown yet.`,
            `// Update the gateway (Settings → Gateways → Updates) to view it here.`,
            ``,
            `export declare function create${pascal(t.id)}Tool(ctx: GatewayRuntime): AgentTool;`,
            ``,
        ].join("\n");
    }

    onMount(async () => {
        try {
            const res = (await sendRequest('tools.inspect', { toolId: gatewayTool.id })) as {
                source?: string | null;
            };
            if (typeof res?.source === "string" && res.source.length > 0) {
                source = res.source;
                sourceState = "ready";
                return;
            }
        } catch {
            // Older gateway — fall through to the stub.
        }
        source = stubSource(gatewayTool);
        sourceState = "stub";
    });

    const emptyCompletion = { envKeys: [], systemKeys: [], moduleKeys: [], databaseKeys: [], modulePaths: [], tables: [] };
</script>

<!-- Gateway Tool Detail View: read-only source (left) + configuration (right) -->
<div class="gateway-split">
<div class="gw-source-pane">
    {#if sourceState === "loading"}
        <div class="gw-source-empty">
            <Loader2 size={18} class="loading-spinner" />
            <span>{m.builder_sourceLoading()}</span>
        </div>
    {:else if source !== null}
        <div class="gw-source-head" class:stub={sourceState === "stub"}>
            <Code2 size={13} />
            <span>{sourceState === "stub" ? m.builder_sourceStub() : m.builder_sourceReadonly()}</span>
        </div>
        <div class="gw-source-editor">
            <CodeMirrorEditor value={source} lang="javascript" readonly completionData={emptyCompletion} />
        </div>
    {/if}
</div>

<div class="gateway-detail">
    <div class="gateway-detail-inner">
        <!-- Tool Info Section -->
        <div class="gw-section">
            <h3 class="gw-section-title">{m.builder_toolConfiguration()}</h3>
            <div class="gw-field-grid">
                <div class="gw-field">
                    <span class="gw-label">{m.builder_toolId()}</span>
                    <span class="gw-value mono">{gatewayTool.id}</span>
                </div>
                <div class="gw-field">
                    <span class="gw-label">{m.builder_status()}</span>
                    <span class="gw-value">
                        <span class="gw-status-dot {gatewayTool.enabled ? 'enabled' : 'disabled'}"></span>
                        {gatewayTool.enabled ? m.tools_enabled() : m.tools_disabled()}
                    </span>
                </div>
            </div>
        </div>

        <!-- Groups -->
        {#if gatewayTool.groups.length > 0}
            <div class="gw-section">
                <h3 class="gw-section-title">{m.builder_groups()}</h3>
                <div class="gw-tags">
                    {#each gatewayTool.groups as group (group)}
                        <span class="gw-tag">{group.replace('group:', '')}</span>
                    {/each}
                </div>
            </div>
        {/if}

        <!-- Flags -->
        <div class="gw-section">
            <h3 class="gw-section-title">{m.builder_flags()}</h3>
            <div class="gw-flags">
                <div class="gw-flag" class:active={gatewayTool.mcpExport}>
                    <span class="gw-flag-label">{m.builder_mcpExport()}</span>
                    <span class="gw-flag-value">{gatewayTool.mcpExport ? m.builder_yes() : m.builder_no()}</span>
                </div>
                <div class="gw-flag" class:active={gatewayTool.multi}>
                    <span class="gw-flag-label">{m.builder_multiInstance()}</span>
                    <span class="gw-flag-value">{gatewayTool.multi ? m.builder_yes() : m.builder_no()}</span>
                </div>
                <div class="gw-flag" class:active={gatewayTool.optional}>
                    <span class="gw-flag-label">{m.builder_optional()}</span>
                    <span class="gw-flag-value">{gatewayTool.optional ? m.builder_yes() : m.builder_no()}</span>
                </div>
            </div>
        </div>

        <!-- Requirements -->
        {#if gatewayTool.requires?.bins?.length || gatewayTool.requires?.env?.length}
            <div class="gw-section">
                <h3 class="gw-section-title">{m.builder_requirements()}</h3>
                {#if gatewayTool.requires?.bins?.length}
                    <div class="gw-field">
                        <span class="gw-label">{m.builder_binaries()}</span>
                        <div class="gw-tags">
                            {#each gatewayTool.requires.bins as bin (bin)}
                                <span class="gw-tag mono">{bin}</span>
                            {/each}
                        </div>
                    </div>
                {/if}
                {#if gatewayTool.requires?.env?.length}
                    <div class="gw-field" style="margin-top: 0.75rem">
                        <span class="gw-label">{m.builder_envVars()}</span>
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
                <h3 class="gw-section-title">{m.builder_installInstructions()}</h3>
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
                <h3 class="gw-section-title">{m.builder_conditionTitle()}</h3>
                <code class="gw-condition">{gatewayTool.condition}</code>
            </div>
        {/if}

        <!-- Toggle Button (admin only) -->
        {#if isAdmin}
            <div class="gw-section">
                <button
                    type="button"
                    class="gw-toggle-btn {gatewayTool.enabled ? 'disable' : 'enable'}"
                    onclick={onToggleGatewayToolEnabled}
                >
                    {#if gatewayTool.enabled}
                        <PowerOff size={16} />
                        <span>{m.builder_disableTool()}</span>
                    {:else}
                        <Power size={16} />
                        <span>{m.builder_enableTool()}</span>
                    {/if}
                </button>
            </div>
        {/if}
    </div>
</div>
</div>

<style>
    /* ── Split: source pane + config column ───────────────────────── */
    .gateway-split {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .gw-source-pane {
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--color-border);
    }

    .gw-source-head {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        font-size: var(--font-size-caption);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .gw-source-head.stub {
        color: var(--color-warning, var(--color-warning-border));
        background: color-mix(in srgb, var(--color-warning, var(--color-warning-border)) 6%, transparent);
    }

    .gw-source-editor {
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .gw-source-empty {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        font-size: var(--font-size-body);
        color: var(--color-muted);
    }

    /* ── Gateway Tool Detail View ─────────────────────────────────── */
    .gateway-detail {
        width: min(26rem, 40%);
        flex-shrink: 0;
        min-height: 0;
        overflow-y: auto;
        padding: var(--space-6);
    }

    .gateway-detail-inner {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .gw-section {
        padding: var(--space-4) var(--space-6);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-bg2);
    }

    .gw-section-title {
        font-size: var(--font-size-caption);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-muted);
        margin: 0 0 var(--space-3);
    }

    .gw-field-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-4);
    }

    .gw-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .gw-label {
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-muted);
    }

    .gw-value {
        font-size: var(--font-size-body);
        color: var(--color-foreground);
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .gw-value.mono, .mono {
        font-family: var(--font-mono, monospace);
    }

    .gw-status-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: var(--radius-full);
        flex-shrink: 0;
    }

    .gw-status-dot.enabled {
        background: var(--color-success, var(--color-success-fg));
        box-shadow: var(--shadow-status-glow);
    }

    .gw-status-dot.disabled {
        background: var(--color-muted);
    }

    .gw-tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .gw-tag {
        font-size: var(--font-size-caption);
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-md);
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
        gap: var(--space-2);
    }

    .gw-flag {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-1);
        padding: var(--space-2);
        border-radius: var(--radius-md);
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
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-muted);
    }

    .gw-flag-value {
        font-size: var(--font-size-caption);
        font-weight: 500;
        color: var(--color-foreground);
    }

    .gw-install-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gw-install-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
    }

    .gw-install-kind {
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-muted);
        min-width: 4rem;
    }

    .gw-install-cmd {
        font-size: var(--font-size-caption);
        font-family: var(--font-mono, monospace);
        color: var(--color-accent);
    }

    .gw-condition {
        display: block;
        font-size: var(--font-size-caption);
        font-family: var(--font-mono, monospace);
        color: var(--color-foreground);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
    }

    .gw-toggle-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        width: 100%;
        padding: var(--space-2);
        border-radius: var(--radius-md);
        font-size: var(--font-size-body);
        font-weight: 600;
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        font-family: inherit;
        border: none;
    }

    .gw-toggle-btn.enable {
        color: var(--color-success, var(--color-success-fg));
        background: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 12%, transparent);
    }

    .gw-toggle-btn.enable:hover {
        background: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 20%, transparent);
    }

    .gw-toggle-btn.disable {
        color: var(--color-danger-fg);
        background: var(--color-danger-surface);
    }

    .gw-toggle-btn.disable:hover {
        background: var(--color-danger-surface);
    }
</style>
