<script lang="ts">
    // MCPs section of /capabilities. Lists the in-house MCP servers the gateway
    // hosts. Today the gateway exposes a single aggregated origin at /mcp whose
    // tool list is the union of MCP-exported gateway methods + plugin RPCs, so we
    // derive that one server card from tools.status (mcpExport flag). The gateway
    // does not connect out to external MCP servers yet, so the third-party
    // section is an honest empty state until that exists.
    import { Loader2, Plug, Server } from "lucide-svelte";
    import { onMount } from "svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import { getActiveHost } from "$lib/state/features/hosts.svelte";
    import type { ToolStatusEntry, ToolsStatusReport } from "$lib/types/tools";
    import * as m from "$lib/paraglide/messages";

    let tools = $state<ToolStatusEntry[]>([]);
    let loading = $state(false);
    let error = $state<string | null>(null);

    const exported = $derived(tools.filter((t) => t.mcpExport && t.enabled));

    // ws://host:port → http://host:port/mcp (the bearer-gated aggregated origin).
    const endpoint = $derived.by(() => {
        const url = getActiveHost()?.url;
        if (!url) return "/mcp";
        return url.replace(/^ws/, "http").replace(/\/+$/, "") + "/mcp";
    });

    async function load() {
        if (!conn.connected) return;
        loading = true;
        error = null;
        try {
            const report = (await sendRequest("tools.status", {})) as ToolsStatusReport;
            tools = report.tools;
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to load MCP servers";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        if (conn.connected) load();
        else tools = [];
    });
    onMount(load);
</script>

<div class="flex-1 min-h-0 overflow-y-auto">
    <div class="max-w-4xl mx-auto px-6 py-8">
        <!-- System / in-house MCP servers -->
        <div class="mb-2">
            <h2 class="text-sm font-semibold text-foreground">{m.capabilities_mcp_systemTitle()}</h2>
            <p class="text-xs text-muted mt-0.5">{m.capabilities_mcp_systemDesc()}</p>
        </div>

        {#if loading}
            <div class="loading-container">
                <Loader2 size={24} class="loading-spinner" />
                <span class="loading-text">{m.common_loading()}</span>
            </div>
        {:else if !conn.connected}
            <p class="empty-note">{m.capabilities_mcp_disconnected()}</p>
        {:else if error}
            <div class="error-banner">{error}</div>
        {:else}
            <div class="mcp-card mb-8">
                <div class="flex items-center gap-2">
                    <Server size={16} class="text-accent shrink-0" />
                    <span class="text-sm font-semibold text-foreground">{m.capabilities_mcp_gatewayName()}</span>
                    <span class="tag">{m.capabilities_mcp_systemTag()}</span>
                </div>
                <p class="text-xs text-muted mt-1">{m.capabilities_mcp_gatewayDesc()}</p>
                <code class="endpoint">{endpoint}</code>
                <div class="text-[length:var(--font-size-caption)] text-muted mt-2">
                    {m.capabilities_mcp_toolsExposed({ count: exported.length })}
                </div>
                {#if exported.length > 0}
                    <div class="flex flex-wrap gap-1.5 mt-2">
                        {#each exported as t (t.id)}
                            <span class="tool-chip font-mono">{t.id}</span>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}

        <!-- Third-party MCP servers -->
        <div class="mb-2">
            <h2 class="text-sm font-semibold text-foreground">{m.capabilities_mcp_thirdPartyTitle()}</h2>
        </div>
        <div class="empty-card">
            <Plug size={22} class="text-muted opacity-60" />
            <span class="empty-note">{m.capabilities_mcp_thirdPartyEmpty()}</span>
        </div>
    </div>
</div>

<style>
    .mcp-card {
        border: 1px solid var(--hairline);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
        background: var(--color-bg2, color-mix(in srgb, var(--color-text-primary) 2%, transparent));
    }
    .endpoint {
        display: inline-block;
        margin-top: var(--space-2);
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        background: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
        border: 1px solid var(--hairline);
        border-radius: var(--radius-sm);
        padding: var(--space-1) var(--space-2);
    }
    .tag {
        font-size: var(--font-size-telemetry);
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: var(--space-0-5) var(--space-1);
        border-radius: var(--radius-xs);
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    }
    .tool-chip {
        font-size: var(--font-size-telemetry);
        color: var(--color-muted);
        background: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
        border: 1px solid var(--hairline);
        border-radius: var(--radius-sm);
        padding: var(--space-0-5) var(--space-2);
    }
    .empty-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-8) 0;
        border: 1px dashed var(--hairline);
        border-radius: var(--radius-lg);
    }
    .empty-note {
        font-size: var(--font-size-body);
        color: var(--color-muted);
    }
    .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-12) 0;
    }
    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }
    .loading-text {
        font-size: var(--font-size-body);
        color: var(--color-muted);
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .error-banner {
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-md);
        font-size: var(--font-size-caption);
        color: var(--color-danger-fg);
        background: var(--color-danger-surface);
        border: 1px solid var(--color-danger-border);
    }
</style>
