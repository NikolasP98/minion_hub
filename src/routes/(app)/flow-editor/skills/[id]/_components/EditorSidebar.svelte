<script lang="ts">
    import { autosize } from '$lib/actions/autosize';
    import { Loader2, Sparkles, ChevronLeft, ChevronRight, Wrench } from "lucide-svelte";
    import { getToolInfo } from "$lib/data/tool-manifest";
    import EmojiPicker from "$lib/components/builder/EmojiPicker.svelte";
    import {
        skillEditorState, skillEditorDerived,
        buildSkillWithAI, generateGhostChapter,
    } from '$lib/state/builder/skill-editor.svelte';
    import * as m from '$lib/paraglide/messages';

    let { sidebarOpen = $bindable() }: { sidebarOpen: boolean } = $props();
</script>

{#if sidebarOpen}
    <aside class="editor-sidebar">
        <div class="sidebar-content">
            <!-- Emoji + Name -->
            <div class="name-row">
                <EmojiPicker value={skillEditorState.emoji} onSelect={(e) => { skillEditorState.emoji = e; }} />
                <input
                    type="text"
                    class="name-input"
                    bind:value={skillEditorState.name}
                    placeholder={m.builder_skillNamePlaceholder()}
                />
            </div>

            <!-- Description -->
            <textarea
                class="desc-input"
                use:autosize={skillEditorState.description}
                bind:value={skillEditorState.description}
                placeholder={m.builder_skillDescPlaceholder2()}
            ></textarea>

            <!-- Ghost chapter suggestions (AI-02) -->
            {#if skillEditorState.ghostSuggestions.length > 0 || skillEditorState.ghostLoading}
                <div class="ghost-suggestions">
                    {#if skillEditorState.ghostLoading}
                        <div class="ghost-loading">
                            <Loader2 size={12} class="loading-spinner" />
                            <span>{m.builder_suggestingChapters()}</span>
                        </div>
                    {/if}
                    {#each skillEditorState.ghostSuggestions as suggestion (suggestion.name)}
                        <button
                            class="ghost-pill"
                            onclick={() => generateGhostChapter(suggestion.name)}
                            disabled={skillEditorState.aiBuilding}
                            title={suggestion.description || 'Click to generate this chapter'}
                        >
                            <Sparkles size={10} />
                            <span>{suggestion.name}</span>
                        </button>
                    {/each}
                </div>
            {/if}

            <!-- AI Build button -->
            {#if skillEditorState.description.trim().length >= 10}
                <div class="ai-assist-section">
                    <button
                        type="button"
                        class="ai-assist-btn"
                        onclick={buildSkillWithAI}
                        disabled={skillEditorState.aiBuilding}
                    >
                        {#if skillEditorState.aiBuilding}
                            <Loader2 size={14} class="loading-spinner" />
                            <span>{m.builder_buildingPipeline()}</span>
                        {:else}
                            <Sparkles size={14} />
                            <span>{m.builder_buildWithAi()}</span>
                        {/if}
                    </button>
                    {#if skillEditorState.aiBuildError}
                        <span class="ai-assist-error">{skillEditorState.aiBuildError}</span>
                    {/if}
                </div>
            {/if}

            <!-- Tool Pool -->
            <div class="tool-pool-section">
                <h3 class="section-label">
                    <Wrench size={12} class="inline-block mr-1 opacity-50" />
                    {m.builder_toolPool()} <span class="pool-count">{skillEditorDerived.poolToolIds.length}</span>
                </h3>
                {#if skillEditorDerived.poolToolIds.length === 0}
                    <p class="pool-empty-text">
                        {m.builder_toolPoolEmpty()}
                    </p>
                {:else}
                    <div class="pool-chips">
                        {#each skillEditorDerived.poolToolIds as toolId (toolId)}
                            {@const info = getToolInfo(toolId)}
                            <div class="pool-chip" title={info.description}>
                                <span class="pool-chip-icon">{info.icon}</span>
                                <span class="pool-chip-name">{info.name}</span>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>

        <!-- Sidebar collapse button -->
        <button
            class="sidebar-collapse-btn"
            onclick={() => (sidebarOpen = false)}
            title={m.sidebar_collapse()}
        >
            <ChevronLeft size={14} />
        </button>
    </aside>
{:else}
    <!-- Collapsed sidebar: expand button -->
    <button
        class="sidebar-expand-btn"
        onclick={() => (sidebarOpen = true)}
        title={m.sidebar_expand()}
    >
        <ChevronRight size={14} />
    </button>
{/if}

<style>
    .editor-sidebar {
        width: 280px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--color-border);
        background: var(--color-bg);
        position: relative;
    }

    .sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
    }

    .sidebar-collapse-btn {
        position: absolute;
        bottom: 0.75rem;
        right: -12px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        color: var(--color-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 5;
        transition: all 0.15s;
    }
    .sidebar-collapse-btn:hover { color: var(--color-foreground); border-color: var(--color-accent); }

    .sidebar-expand-btn {
        width: 24px;
        flex-shrink: 0;
        background: var(--color-bg);
        border: none;
        border-right: 1px solid var(--color-border);
        color: var(--color-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
    }
    .sidebar-expand-btn:hover { color: var(--color-foreground); background: var(--color-bg2); }

    .name-row { display: flex; align-items: center; gap: 0.75rem; }
    .name-input {
        flex: 1;
        width: 100%;
        font-size: 1rem;
        font-weight: 700;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 0.25rem 0;
        outline: none;
        font-family: inherit;
        transition: border-color 0.15s ease;
    }
    .name-input:focus { border-bottom-color: var(--color-accent); }
    .name-input::placeholder { color: var(--color-muted); }

    .desc-input {
        width: 100%;
        font-size: 0.8125rem;
        color: var(--color-foreground);
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.625rem 0.75rem;
        outline: none;
        resize: vertical;
        font-family: inherit;
        line-height: 1.5;
        transition: border-color 0.15s ease;
    }
    .desc-input:focus { border-color: var(--color-accent); }
    .desc-input::placeholder { color: var(--color-muted); }

    .ai-assist-section { display: flex; flex-direction: column; gap: 0.375rem; }
    .ai-assist-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.875rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: white;
        background: var(--color-accent);
        border: none;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        align-self: flex-start;
    }
    .ai-assist-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .ai-assist-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .ai-assist-error { font-size: 0.6875rem; color: var(--color-error, #ef4444); }

    /* Tool Pool */
    .tool-pool-section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        margin-top: 0.25rem;
    }
    .section-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        display: flex;
        align-items: center;
    }
    .pool-count {
        font-size: 0.5625rem;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 9999px;
        margin-left: 0.25rem;
        font-weight: 500;
    }
    .pool-empty-text {
        font-size: 0.6875rem;
        color: var(--color-muted);
        opacity: 0.6;
        margin: 0;
    }
    .pool-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
    .pool-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font-size: 11px;
    }
    .pool-chip-icon { font-size: 12px; }
    .pool-chip-name { color: var(--color-foreground); font-weight: 500; }

    /* Ghost chapter suggestions (AI-02) */
    .ghost-suggestions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
        padding: 0.25rem 0;
    }
    .ghost-loading {
        display: flex; align-items: center; gap: 0.375rem;
        font-size: 0.6875rem; color: var(--color-muted); opacity: 0.6; width: 100%;
    }
    .ghost-pill {
        display: inline-flex; align-items: center; gap: 0.25rem;
        padding: 0.25rem 0.625rem;
        font-size: 0.6875rem; font-weight: 500; font-family: inherit;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 4%, transparent);
        border: 1px dashed color-mix(in srgb, var(--color-accent) 25%, transparent);
        border-radius: 9999px;
        cursor: pointer; opacity: 0.55;
        transition: all 0.2s ease;
    }
    .ghost-pill:hover:not(:disabled) {
        opacity: 0.85;
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    }
    .ghost-pill:disabled { cursor: not-allowed; opacity: 0.3; }
</style>
