<script lang="ts">
    import { ChevronDown, ChevronRight, Trash2 } from "lucide-svelte";
    import type { AgentGroup } from "$lib/state/features/agent-groups.svelte";
    import * as m from "$lib/paraglide/messages";

    let {
        group,
        collapsed = false,
        onToggle,
        onRename,
        onDelete,
        onDrop,
        onDragOver,
        onDragLeave,
    }: {
        group: AgentGroup;
        collapsed?: boolean;
        onToggle: () => void;
        onRename: (name: string) => void;
        onDelete: () => void;
        onDrop: (e: DragEvent) => void;
        onDragOver: (e: DragEvent) => void;
        onDragLeave: () => void;
    } = $props();

    let editing = $state(false);
    let editName = $state(group.name);
    let dragOver = $state(false);
    let inputEl: HTMLInputElement | undefined = $state();

    function startEdit() {
        editName = group.name;
        editing = true;
        requestAnimationFrame(() => inputEl?.select());
    }

    function commitEdit() {
        editing = false;
        const trimmed = editName.trim();
        if (trimmed && trimmed !== group.name) {
            onRename(trimmed);
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") commitEdit();
        if (e.key === "Escape") {
            editing = false;
            editName = group.name;
        }
    }

    function handleDragOver(e: DragEvent) {
        dragOver = true;
        onDragOver(e);
    }

    function handleDragLeave() {
        dragOver = false;
        onDragLeave();
    }

    function handleDrop(e: DragEvent) {
        dragOver = false;
        onDrop(e);
    }

    function handleDeleteClick(e: MouseEvent) {
        e.stopPropagation();
        if (confirm(m.agentGroup_deleteConfirm())) {
            onDelete();
        }
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer select-none border-b border-border/50 transition-colors group/header {dragOver
        ? 'bg-accent/10 border-accent/30'
        : 'hover:bg-white/3'}"
    onclick={onToggle}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    role="button"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
>
    <span class="text-muted-foreground shrink-0">
        {#if collapsed}
            <ChevronRight size={12} />
        {:else}
            <ChevronDown size={12} />
        {/if}
    </span>

    {#if editing}
        <input
            bind:this={inputEl}
            bind:value={editName}
            class="flex-1 text-[11px] font-semibold uppercase tracking-wider bg-transparent border-b border-accent/50 text-foreground outline-none px-0 py-0"
            onblur={commitEdit}
            onkeydown={handleKeydown}
        />
    {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
            class="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate"
            ondblclick={(e) => { e.stopPropagation(); startEdit(); }}
        >
            {group.name}
        </span>
    {/if}

    <span class="text-[9px] text-muted-foreground/50 tabular-nums shrink-0">
        {group.memberAgentIds.length}
    </span>

    <button
        class="opacity-0 group-hover/header:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0 p-0.5"
        onclick={handleDeleteClick}
        title={m.agentGroup_delete()}
    >
        <Trash2 size={11} />
    </button>
</div>
