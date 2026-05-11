<script lang="ts">
    import { Copy, ChevronRight, ChevronDown, User, Bot, Wrench } from 'lucide-svelte';
    import { fmtTimeAgo } from '$lib/utils/format';
    import * as m from '$lib/paraglide/messages';
    import AIDisclosureBadge from '$lib/components/chat/AIDisclosureBadge.svelte';

    interface TranscriptTurn {
        id: string;
        role: 'user' | 'assistant' | 'tool';
        content: string;
        timestamp?: number;
        toolName?: string;
        toolInput?: string;
        toolOutput?: string;
        reasoning?: string;
    }

    interface Props {
        turns: TranscriptTurn[];
    }

    let { turns }: Props = $props();

    let expandedTools: Set<string> = $state(new Set());
    let expandedReasoning: Set<string> = $state(new Set());

    function toggleTool(id: string) {
        const next = new Set(expandedTools);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        expandedTools = next;
    }

    function toggleReasoning(id: string) {
        const next = new Set(expandedReasoning);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        expandedReasoning = next;
    }

    async function copyContent(text: string) {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // fallback: no-op
        }
    }

    const roleBadge: Record<string, { label: () => string; class: string; icon: typeof User }> = {
        user: { label: () => m.session_roleUser(), class: 'bg-blue-500/15 text-blue-400 border-blue-500/25', icon: User },
        assistant: { label: () => m.session_roleAssistant(), class: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', icon: Bot },
        tool: { label: () => m.session_roleTool(), class: 'bg-amber-500/15 text-amber-400 border-amber-500/25', icon: Wrench },
    };
</script>

<div class="flex flex-col gap-1">
    {#each turns as turn (turn.id)}
        {@const badge = roleBadge[turn.role] ?? roleBadge.assistant}
        <div class="group relative bg-bg3/50 border border-border rounded-lg px-4 py-3 hover:border-border/80 transition-colors">
            <!-- Header: role badge + timestamp + copy -->
            <div class="flex items-center gap-2 mb-2">
                <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider {badge.class}">
                    <badge.icon size={10} />
                    <span>{badge.label()}</span>
                </div>
                {#if turn.toolName}
                    <span class="text-[10px] font-mono text-muted-foreground bg-bg2 px-1.5 py-0.5 rounded">
                        {turn.toolName}
                    </span>
                {/if}
                <span class="flex-1"></span>
                {#if turn.timestamp}
                    <span class="text-[10px] text-muted-foreground/50 tabular-nums">
                        {fmtTimeAgo(turn.timestamp)}
                    </span>
                {/if}
                <button
                    class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-bg2 text-muted hover:text-foreground"
                    onclick={() => copyContent(turn.content)}
                    title={m.session_copy()}
                >
                    <Copy size={12} />
                </button>
            </div>

            <!-- Content -->
            <div class="text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
                {turn.content}
            </div>
            {#if turn.role === 'assistant'}
                <div class="mt-1 text-right">
                    <AIDisclosureBadge />
                </div>
            {/if}

            <!-- Reasoning block (collapsible) -->
            {#if turn.reasoning}
                <div class="mt-3">
                    <button
                        class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        onclick={() => toggleReasoning(turn.id)}
                    >
                        {#if expandedReasoning.has(turn.id)}
                            <ChevronDown size={12} />
                        {:else}
                            <ChevronRight size={12} />
                        {/if}
                        {m.session_reasoning()}
                    </button>
                    {#if expandedReasoning.has(turn.id)}
                        <div class="mt-2 px-3 py-2 rounded-md bg-bg2/80 border border-border/50 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-mono">
                            {turn.reasoning}
                        </div>
                    {/if}
                </div>
            {/if}

            <!-- Tool call details (expandable) -->
            {#if turn.role === 'tool' && (turn.toolInput || turn.toolOutput)}
                <div class="mt-3">
                    <button
                        class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        onclick={() => toggleTool(turn.id)}
                    >
                        {#if expandedTools.has(turn.id)}
                            <ChevronDown size={12} />
                        {:else}
                            <ChevronRight size={12} />
                        {/if}
                        {m.session_details()}
                    </button>
                    {#if expandedTools.has(turn.id)}
                        <div class="mt-2 space-y-2">
                            {#if turn.toolInput}
                                <div>
                                    <div class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-1">{m.session_input()}</div>
                                    <pre class="px-3 py-2 rounded-md bg-bg2/80 border border-border/50 text-xs text-foreground/70 overflow-x-auto font-mono">{turn.toolInput}</pre>
                                </div>
                            {/if}
                            {#if turn.toolOutput}
                                <div>
                                    <div class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-1">{m.session_output()}</div>
                                    <pre class="px-3 py-2 rounded-md bg-bg2/80 border border-border/50 text-xs text-foreground/70 overflow-x-auto font-mono">{turn.toolOutput}</pre>
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/each}

    {#if turns.length === 0}
        <div class="py-8 text-center text-sm text-muted-foreground">
            {m.session_noTranscriptData()}
        </div>
    {/if}
</div>
