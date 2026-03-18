<script lang="ts">
    import {
        SvelteFlow,
        Background,
        Controls,
        BackgroundVariant,
        type Node,
        type Edge,
        type NodeTypes,
        type ColorMode,
    } from '@xyflow/svelte';
    import '@xyflow/svelte/dist/style.css';
    import { Plus, BookOpen, GitBranch, Trash2 } from 'lucide-svelte';
    import { theme } from '$lib/state/ui/theme.svelte';
    import ConditionNode from './ConditionNode.svelte';

    // ── Types ────────────────────────────────────────────────────────────────
    interface ChapterNode {
        id: string;
        type?: string;
        name: string;
        description: string;
        guide: string;
        context: string;
        outputDef: string;
        conditionText?: string;
        positionX: number;
        positionY: number;
    }

    interface ChapterEdge {
        id: string;
        sourceChapterId: string;
        targetChapterId: string;
        label: string | null;
    }

    interface Props {
        chapters: ChapterNode[];
        edges: ChapterEdge[];
        onChapterClick: (chapter: ChapterNode) => void;
        onChapterPositionChange: (chapterId: string, x: number, y: number) => void;
        onAddChapter: () => void;
        onAddCondition: () => void;
        onDeleteChapter: (chapter: ChapterNode) => void;
        onConnect: (sourceId: string, targetId: string, label?: string) => void;
        onDeleteEdge: (edgeId: string) => void;
    }

    let {
        chapters,
        edges,
        onChapterClick,
        onChapterPositionChange,
        onAddChapter,
        onAddCondition,
        onDeleteChapter,
        onConnect,
        onDeleteEdge,
    }: Props = $props();

    // ── xyflow configuration ─────────────────────────────────────────────────
    const nodeTypes: NodeTypes = {
        condition: ConditionNode,
    } as unknown as NodeTypes;

    const colorMode: ColorMode = $derived(
        theme.preset.id === 'light' ? 'light' : 'dark',
    );

    // ── Convert chapters → xyflow nodes ──────────────────────────────────────
    const flowNodes: Node[] = $derived(
        chapters.map((ch, i) => {
            if (ch.type === 'condition') {
                return {
                    id: ch.id,
                    type: 'condition',
                    position: { x: ch.positionX, y: ch.positionY },
                    data: { label: ch.name, conditionText: ch.conditionText ?? '' },
                };
            }
            return {
                id: ch.id,
                type: 'default' as const,
                position: { x: ch.positionX, y: ch.positionY },
                data: { label: `${i + 1}. ${ch.name}` },
            };
        }),
    );

    // ── Convert edges → xyflow edges ─────────────────────────────────────────
    const flowEdges: Edge[] = $derived(
        edges.map((e) => ({
            id: e.id,
            source: e.sourceChapterId,
            target: e.targetChapterId,
            sourceHandle: e.label === 'Yes' ? 'yes' : e.label === 'No' ? 'no' : undefined,
            label: e.label ?? undefined,
            animated: true,
            style: e.label === 'Yes'
                ? 'stroke: var(--color-success, #22c55e); stroke-width: 2;'
                : e.label === 'No'
                ? 'stroke: var(--color-error, #ef4444); stroke-width: 2;'
                : 'stroke: var(--color-accent); stroke-width: 2;',
        })),
    );

    // ── Event handlers ───────────────────────────────────────────────────────
    function handleNodeDragStop({
        targetNode,
    }: {
        targetNode: Node | null;
        nodes: Node[];
        event: MouseEvent | TouchEvent;
    }) {
        if (!targetNode) return;
        onChapterPositionChange(
            targetNode.id,
            targetNode.position.x,
            targetNode.position.y,
        );
    }

    function handleNodeClick({
        node,
    }: {
        node: Node;
        event: MouseEvent | TouchEvent;
    }) {
        const chapter = chapters.find((ch) => ch.id === node.id);
        if (chapter) onChapterClick(chapter);
    }

    function handleConnect(connection: { source: string; target: string; sourceHandle?: string | null }) {
        // Determine edge label from source handle (condition nodes)
        const label = connection.sourceHandle === 'yes' ? 'Yes'
            : connection.sourceHandle === 'no' ? 'No'
            : undefined;
        onConnect(connection.source, connection.target, label);
    }

    function handleDelete({
        nodes: deletedNodes,
        edges: deletedEdges,
    }: {
        nodes: Node[];
        edges: Edge[];
    }) {
        for (const node of deletedNodes) {
            const chapter = chapters.find((ch) => ch.id === node.id);
            if (chapter) onDeleteChapter(chapter);
        }
        for (const edge of deletedEdges) {
            onDeleteEdge(edge.id);
        }
    }

    // ── Context menu ─────────────────────────────────────────────────────────
    interface ContextMenuState {
        type: 'node' | 'edge';
        id: string;
        x: number;
        y: number;
    }

    let contextMenu = $state<ContextMenuState | null>(null);

    function handleNodeContextMenu({ node, event }: { node: Node; event: MouseEvent }) {
        event.preventDefault();
        contextMenu = { type: 'node', id: node.id, x: event.clientX, y: event.clientY };
    }

    function handleEdgeContextMenu({ edge, event }: { edge: Edge; event: MouseEvent }) {
        event.preventDefault();
        contextMenu = { type: 'edge', id: edge.id, x: event.clientX, y: event.clientY };
    }

    function closeContextMenu() {
        contextMenu = null;
    }

    function handleCtxDelete() {
        if (!contextMenu) return;
        if (contextMenu.type === 'node') {
            const chapter = chapters.find((ch) => ch.id === contextMenu!.id);
            if (chapter) onDeleteChapter(chapter);
        } else {
            onDeleteEdge(contextMenu.id);
        }
        contextMenu = null;
    }

    function handleCtxKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') closeContextMenu();
    }
</script>

<div class="chapter-dag-container">
    {#if chapters.length === 0}
        <div class="chapters-empty-state">
            <BookOpen size={28} strokeWidth={1.5} />
            <p>Add chapters to build the execution flow</p>
            <div class="empty-actions">
                <button type="button" class="add-chapter-btn" onclick={onAddChapter}>
                    <Plus size={14} />
                    <span>Add Chapter</span>
                </button>
                <button type="button" class="add-condition-btn" onclick={onAddCondition}>
                    <GitBranch size={14} />
                    <span>Add Condition</span>
                </button>
            </div>
        </div>
    {:else}
        <div class="floating-btns">
            <button
                type="button"
                class="add-chapter-btn"
                onclick={onAddChapter}
            >
                <Plus size={12} />
                <span>Chapter</span>
            </button>
            <button
                type="button"
                class="add-condition-btn"
                onclick={onAddCondition}
            >
                <GitBranch size={12} />
                <span>Condition</span>
            </button>
        </div>

        <SvelteFlow
            nodes={flowNodes}
            edges={flowEdges}
            {nodeTypes}
            {colorMode}
            fitView
            onnodedragstop={handleNodeDragStop}
            onnodeclick={handleNodeClick}
            onconnect={handleConnect}
            ondelete={handleDelete}
            onnodecontextmenu={handleNodeContextMenu}
            onedgecontextmenu={handleEdgeContextMenu}
            onpaneclick={closeContextMenu}
            proOptions={{ hideAttribution: true }}
        >
            <Background
                variant={BackgroundVariant.Dots}
                gap={16}
                size={1}
                patternColor="var(--color-muted, #666)"
            />
            <Controls position="bottom-right" />
        </SvelteFlow>
    {/if}

    {#if contextMenu}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="ctx-backdrop" onclick={closeContextMenu} onkeydown={handleCtxKeydown}></div>
        <div
            class="ctx-menu"
            style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
            role="menu"
        >
            <button type="button" class="ctx-item danger" onclick={handleCtxDelete} role="menuitem">
                <Trash2 size={13} />
                <span>{contextMenu.type === 'node' ? 'Delete Chapter' : 'Delete Connection'}</span>
            </button>
        </div>
    {/if}
</div>

<style>
    .chapter-dag-container {
        position: relative;
        width: 100%;
        height: 100%;
        background: var(--color-dag-bg, var(--color-bg));
    }

    /* ── Empty state ──────────────────────────────────────────────────── */
    .chapters-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 0.5rem;
        color: var(--color-muted, #999);
    }

    .chapters-empty-state p {
        font-size: 0.75rem;
        margin: 0.25rem 0 0.75rem;
        opacity: 0.7;
    }

    .empty-actions {
        display: flex;
        gap: 0.5rem;
    }

    /* ── Add chapter button ───────────────────────────────────────────── */
    .add-chapter-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        font-size: 0.7rem;
        font-weight: 600;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .add-chapter-btn:hover {
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    }

    /* ── Add condition button ─────────────────────────────────────────── */
    .add-condition-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        font-size: 0.7rem;
        font-weight: 600;
        color: var(--color-warning, #f59e0b);
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 25%, transparent);
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .add-condition-btn:hover {
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 18%, transparent);
        border-color: color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent);
    }

    /* ── Floating buttons over canvas ─────────────────────────────────── */
    .floating-btns {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        z-index: 5;
        display: flex;
        gap: 0.375rem;
    }

    /* ── xyflow theme overrides ───────────────────────────────────────── */
    .chapter-dag-container :global(.svelte-flow) {
        --xy-background-color: var(--color-dag-bg, var(--color-bg));
        --xy-node-background-color: var(--color-bg2, #1a1a2e);
        --xy-node-border-color: var(--color-border, #333);
        --xy-node-color: var(--color-foreground, #e0e0e0);
        --xy-edge-stroke: var(--color-accent, #6366f1);
        --xy-handle-background-color: var(--color-accent, #6366f1);
        --xy-handle-border-color: var(--color-bg, #0f0f1a);
    }

    /* Accent left border on chapter nodes */
    .chapter-dag-container :global(.svelte-flow__node-default) {
        border-left: 3px solid var(--color-accent, #6366f1);
        font-size: 0.75rem;
        font-family: inherit;
    }

    /* ── Context Menu ─────────────────────────────────────────────────── */
    .ctx-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99;
    }

    .ctx-menu {
        position: fixed;
        z-index: 100;
        min-width: 9rem;
        padding: 0.25rem;
        background: var(--color-bg2, #1a1a2e);
        border: 1px solid var(--color-border, #333);
        border-radius: 0.375rem;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }

    .ctx-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.375rem 0.625rem;
        font-size: 0.75rem;
        font-family: inherit;
        font-weight: 500;
        border: none;
        border-radius: 0.25rem;
        background: transparent;
        cursor: pointer;
        text-align: left;
        transition: background 0.1s ease;
    }

    .ctx-item.danger {
        color: var(--color-error, #ef4444);
    }

    .ctx-item.danger:hover {
        background: color-mix(in srgb, var(--color-error, #ef4444) 12%, transparent);
    }

    /* Edge labels */
    .chapter-dag-container :global(.svelte-flow__edge-textbg) {
        fill: var(--color-bg2, #1a1a2e);
    }

    .chapter-dag-container :global(.svelte-flow__edge-text) {
        fill: var(--color-foreground, #e0e0e0);
        font-size: 10px;
        font-weight: 600;
    }
</style>
