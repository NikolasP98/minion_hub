<script lang="ts">
    import { Terminal, X } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';

    type ConsoleLine = { text: string; type: "stdout" | "stderr" | "system" };

    interface Props {
        consoleLines: ConsoleLine[];
        running: boolean;
        consoleEl: HTMLDivElement | undefined;
        onClearConsole: () => void;
    }

    let {
        consoleLines,
        running,
        consoleEl = $bindable(),
        onClearConsole,
    }: Props = $props();
</script>

<!-- Right Pane: Console -->
<div class="pane-right">
    <div class="console-header">
        <span class="console-title">
            <Terminal size={14} />
            <span>{m.builder_console()}</span>
        </span>
        <button
            type="button"
            class="console-clear"
            onclick={onClearConsole}
            title={m.builder_clearConsole()}
        >
            <X size={12} />
            <span>{m.builder_clear()}</span>
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

<style>
    .pane-right {
        display: flex;
        flex-direction: column;
        width: 40%;
        min-width: 0;
        min-height: 0;
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
        transition: all var(--duration-instant) var(--ease-standard);
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
</style>
