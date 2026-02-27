<script lang="ts">
    import * as m from "$lib/paraglide/messages";

    let {
        fromName,
        toName,
        x,
        y,
        onSubmit,
        onCancel,
    }: {
        fromName: string;
        toName: string;
        x: number;
        y: number;
        onSubmit: (label: string) => void;
        onCancel: () => void;
    } = $props();

    let label = $state("");
    let inputEl: HTMLInputElement | undefined = $state();

    $effect(() => {
        inputEl?.focus();
    });

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && label.trim()) {
            onSubmit(label.trim());
        } else if (e.key === "Escape") {
            onCancel();
        }
    }

    function handleSubmit() {
        if (label.trim()) {
            onSubmit(label.trim());
        }
    }
</script>

<!-- Transparent backdrop -->
<div
    class="fixed inset-0 z-50"
    role="button"
    tabindex="-1"
    aria-label="Cancel"
    onmousedown={onCancel}
></div>

<!-- Floating dialog -->
<div
    class="fixed z-50 w-60 rounded-lg border border-border bg-bg2 p-3 shadow-xl"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    style="left: {x}px; top: {y}px; transform: translate(-50%, -50%);"
    onmousedown={(e) => e.stopPropagation()}
>
    <div class="mb-2 font-mono text-[11px] text-muted">
        {m.workshop_linkTitle({ fromName, toName })}
    </div>

    <input
        bind:this={inputEl}
        bind:value={label}
        type="text"
        placeholder={m.workshop_linkPlaceholder()}
        class="mb-2 w-full rounded border border-border bg-bg3 px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-accent"
        onkeydown={handleKeydown}
    />

    <div class="flex justify-end gap-1.5">
        <button
            type="button"
            class="rounded px-2 py-1 font-mono text-[10px] text-muted hover:text-foreground"
            onclick={onCancel}
        >
            {m.common_cancel()}
        </button>
        <button
            type="button"
            class="rounded border border-accent/30 bg-accent/20 px-2 py-1 font-mono text-[10px] text-accent hover:bg-accent/30"
            onclick={handleSubmit}
            disabled={!label.trim()}
        >
            {m.workshop_link()}
        </button>
    </div>
</div>
