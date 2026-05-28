<script lang="ts">
    import { Power, PowerOff } from "lucide-svelte";
    import type { ToolStatusEntry } from "$lib/types/tools";
    import * as m from '$lib/paraglide/messages';

    interface Props {
        gatewayTool: ToolStatusEntry;
        isAdmin: boolean;
        onToggleGatewayToolEnabled: () => void;
    }

    let { gatewayTool, isAdmin, onToggleGatewayToolEnabled }: Props = $props();
</script>

<!-- Gateway Tool Detail View -->
<div class="gateway-detail">
    <div class="gateway-detail-inner">
        <!-- Tool Info Section -->
        <div class="gw-section">
            <h3 class="gw-section-title">{m.builder_toolConfiguration()}</h3>
            <div class="gw-field-grid">
                <div class="gw-field">
                    <label class="gw-label">{m.builder_toolId()}</label>
                    <span class="gw-value mono">{gatewayTool.id}</span>
                </div>
                <div class="gw-field">
                    <label class="gw-label">{m.builder_status()}</label>
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
                        <label class="gw-label">{m.builder_binaries()}</label>
                        <div class="gw-tags">
                            {#each gatewayTool.requires.bins as bin (bin)}
                                <span class="gw-tag mono">{bin}</span>
                            {/each}
                        </div>
                    </div>
                {/if}
                {#if gatewayTool.requires?.env?.length}
                    <div class="gw-field" style="margin-top: 0.75rem">
                        <label class="gw-label">{m.builder_envVars()}</label>
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

<style>
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
