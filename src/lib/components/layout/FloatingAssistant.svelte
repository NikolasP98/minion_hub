<script lang="ts">
    import { Sparkles, X, Send, ChevronDown, AlertCircle } from 'lucide-svelte';
    import {
        assistant,
        toggleAssistant,
        closeAssistant,
        loadPersonalAgent,
    } from '$lib/state/features/assistant.svelte';
    import { userState } from '$lib/state/features/user.svelte';
    import { ui } from '$lib/state/ui/ui.svelte';
    import { conn } from '$lib/state/gateway/connection.svelte';
    import { agentChat } from '$lib/state/chat/chat.svelte';
    import { sendChatMsg, loadChatHistory } from '$lib/services/gateway.svelte';
    import { extractText } from '$lib/utils/text';
    import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
    import { page } from '$app/state';
    import { onMount, tick } from 'svelte';

    let inputEl: HTMLTextAreaElement | undefined = $state();
    let messagesEl: HTMLDivElement | null = $state(null);
    let atBottom = $state(true);

    // Load personal agent + key bindings
    onMount(() => {
        loadPersonalAgent();

        function onKey(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                toggleAssistant();
                if (assistant.open) requestAnimationFrame(() => inputEl?.focus());
            }
            if (e.key === 'Escape' && assistant.open) {
                closeAssistant();
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    // Update scope reactively from current route + selected agent
    $effect(() => {
        assistant.scope.route = page.url.pathname;
        assistant.scope.agentId = ui.selectedAgentId;
    });

    // When opened + connected + we know the agent ID, lazy-load chat history
    $effect(() => {
        if (assistant.open && conn.connected && assistant.personalAgentId) {
            const id = assistant.personalAgentId;
            const existing = agentChat[id];
            if (!existing || existing.messages.length === 0) {
                loadChatHistory(id);
            }
        }
    });

    const chat = $derived(
        assistant.personalAgentId ? agentChat[assistant.personalAgentId] : undefined,
    );
    const messages = $derived(chat?.messages ?? []);
    const sending = $derived(chat?.sending ?? false);
    const stream = $derived(chat?.stream ?? null);

    const greeting = $derived.by(() => {
        const name = userState.user?.displayName?.split(' ')[0] ?? 'there';
        return `Hi ${name}`;
    });

    const scopeLabel = $derived.by(() => {
        const parts: string[] = [];
        if (assistant.scope.route && assistant.scope.route !== '/') {
            parts.push(assistant.scope.route);
        }
        if (assistant.scope.agentId) {
            parts.push(`agent: ${assistant.scope.agentId}`);
        }
        return parts.length > 0 ? parts.join(' · ') : 'Home';
    });

    const canSend = $derived(
        !!assistant.personalAgentId && conn.connected && !sending,
    );

    // Local-only draft — written to chat.inputText only at send time, no
    // bidirectional $effect mirroring (that creates reactive loops that
    // interfere with chat.messages tracking downstream).
    let draft = $state('');

    function send() {
        if (!canSend) return;
        const id = assistant.personalAgentId;
        if (!id) return;
        const c = agentChat[id];
        if (!c) return;
        const text = draft.trim();
        if (!text) return;
        c.inputText = text;
        sendChatMsg(id); // pushes user message, sends RPC, clears inputText
        draft = '';
    }

    function onInputKey(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    }

    // Auto-scroll
    function handleScroll() {
        if (!messagesEl) return;
        const { scrollTop, scrollHeight, clientHeight } = messagesEl;
        atBottom = scrollHeight - scrollTop - clientHeight < 40;
    }
    $effect(() => {
        void messages.length;
        void stream;
        if (atBottom) {
            tick().then(() => {
                if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
            });
        }
    });

    function fmtTime(ts: number | undefined): string {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function msgRole(msg: unknown): 'user' | 'assistant' {
        return (msg as { role?: string }).role === 'user' ? 'user' : 'assistant';
    }

    function msgTs(msg: unknown): number | undefined {
        return (msg as { timestamp?: number }).timestamp;
    }
</script>

<!-- Pill (collapsed state) -->
{#if !assistant.open}
    <button
        type="button"
        onclick={toggleAssistant}
        class="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-bg2 border border-border shadow-lg hover:border-accent/50 hover:bg-bg3 transition-all group"
        aria-label="Open assistant"
        title="Open assistant (⌘K)"
    >
        <span class="relative flex items-center justify-center w-5 h-5">
            <Sparkles size={14} class="text-accent" />
        </span>
        <span class="text-xs font-medium text-foreground">Ask anything</span>
        <kbd class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-bg3 text-muted-foreground border border-border">⌘K</kbd>
    </button>
{:else}
    <!-- Expanded panel -->
    <div
        class="fixed bottom-5 right-5 z-50 w-[380px] h-[560px] flex flex-col bg-bg2 border border-border rounded-xl shadow-2xl overflow-hidden"
        style="animation: assistant-pop-in 220ms cubic-bezier(.2,.8,.2,1)"
    >
        <!-- Header -->
        <div class="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-border bg-bg3/40">
            <Sparkles size={14} class="text-accent" />
            <span class="text-xs font-semibold text-foreground flex-1">Assistant</span>
            {#if !conn.connected}
                <span class="text-[9px] text-muted-foreground px-1.5 py-0.5 rounded bg-bg3 border border-border">offline</span>
            {/if}
            <button
                type="button"
                onclick={closeAssistant}
                class="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg3 transition-colors"
                aria-label="Close assistant"
            >
                <X size={14} />
            </button>
        </div>

        <!-- Messages -->
        <div
            class="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0 [scrollbar-width:thin]"
            bind:this={messagesEl}
            onscroll={handleScroll}
        >
            {#if assistant.loading}
                <div class="h-full flex items-center justify-center text-[11px] text-muted-foreground">
                    Loading assistant…
                </div>
            {:else if assistant.error}
                <div class="h-full flex flex-col items-center justify-center text-center px-6">
                    <AlertCircle size={20} class="text-destructive mb-2" />
                    <p class="text-[11px] text-muted-foreground">{assistant.error}</p>
                </div>
            {:else if !assistant.personalAgentId}
                <div class="h-full flex items-center justify-center text-[11px] text-muted-foreground">
                    Connecting…
                </div>
            {:else if messages.length === 0 && !chat?.loading && !stream}
                <div class="h-full flex flex-col items-center justify-center text-center px-6">
                    <div class="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center mb-3">
                        <Sparkles size={20} class="text-accent" />
                    </div>
                    <h3 class="text-sm font-semibold text-foreground mb-1">{greeting}</h3>
                    <p class="text-[11px] text-muted-foreground leading-relaxed">
                        Ask anything about the hub. I'll see what you're viewing and can run tools and skills your personal agent has enabled.
                    </p>
                </div>
            {:else}
                {#each messages as msg, i (`${msgTs(msg) ?? ''}_${i}`)}
                    {@const text = extractText(msg) ?? ''}
                    {@const role = msgRole(msg)}
                    {#if text}
                        <div class="flex flex-col gap-0.5 {role === 'user' ? 'items-end' : 'items-start'}">
                            <div
                                class="max-w-[85%] rounded-lg px-3 py-2 text-[12px] leading-relaxed break-words {role === 'user'
                                    ? 'bg-accent/15 text-foreground border border-accent/20 whitespace-pre-wrap'
                                    : 'bg-bg3 text-foreground border border-border/60'}"
                            >
                                {#if role === 'assistant'}
                                    <MarkdownMessage value={text} tone="assistant" />
                                {:else}
                                    {text}
                                {/if}
                            </div>
                            {#if msgTs(msg)}
                                <span class="text-[9px] text-muted-foreground/60 px-1 tabular-nums">
                                    {fmtTime(msgTs(msg))}
                                </span>
                            {/if}
                        </div>
                    {/if}
                {/each}

                {#if stream !== null && stream !== ''}
                    <div class="flex flex-col gap-0.5 items-start">
                        <div class="max-w-[85%] rounded-lg px-3 py-2 text-[12px] leading-relaxed break-words bg-bg3 text-foreground border border-dashed border-border opacity-90">
                            <MarkdownMessage value={stream} tone="assistant" />
                        </div>
                    </div>
                {:else if sending}
                    <div class="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                        <span class="flex gap-1">
                            <span class="w-1 h-1 rounded-full bg-accent animate-pulse"></span>
                            <span class="w-1 h-1 rounded-full bg-accent animate-pulse" style="animation-delay: 100ms"></span>
                            <span class="w-1 h-1 rounded-full bg-accent animate-pulse" style="animation-delay: 200ms"></span>
                        </span>
                        Thinking…
                    </div>
                {/if}

                {#if chat?.lastError}
                    <div class="flex items-start gap-1.5 px-2 py-1.5 text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
                        <AlertCircle size={11} class="mt-0.5 shrink-0" />
                        <span class="break-words">{chat.lastError}</span>
                    </div>
                {/if}
            {/if}
        </div>

        <!-- Scope badge + input -->
        <div class="shrink-0 border-t border-border bg-bg3/40">
            <div class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/60">
                <span class="font-semibold uppercase tracking-wider">Viewing:</span>
                <span class="truncate flex-1">{scopeLabel}</span>
                <ChevronDown size={10} class="opacity-50" />
            </div>
            <div class="p-2.5">
                <div class="flex items-end gap-2">
                    <textarea
                        bind:this={inputEl}
                        bind:value={draft}
                        onkeydown={onInputKey}
                        rows="1"
                        placeholder={canSend ? 'Ask anything…' : conn.connected ? 'Loading…' : 'Gateway offline'}
                        disabled={!canSend && !!assistant.personalAgentId}
                        class="flex-1 min-w-0 resize-none bg-bg border border-border rounded-md px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent/50 max-h-[120px] disabled:opacity-50"
                    ></textarea>
                    <button
                        type="button"
                        onclick={send}
                        disabled={!draft.trim() || !canSend}
                        class="shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-accent text-bg hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        aria-label="Send"
                    >
                        <Send size={12} />
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    @keyframes assistant-pop-in {
        from {
            opacity: 0;
            transform: translateY(8px) scale(0.96);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
</style>
