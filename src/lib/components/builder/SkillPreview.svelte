<script lang="ts">
    import { X, Check, AlertTriangle, XCircle, ArrowDown } from "lucide-svelte";
    import { SvelteMap } from "svelte/reactivity";
    import { getToolInfo } from "$lib/data/tool-manifest";

    // ── Types ────────────────────────────────────────────────────────────────
    interface ChapterData {
        id: string;
        name: string;
        description: string;
        guide: string;
        context: string;
        outputDef: string;
    }

    interface EdgeData {
        id: string;
        sourceChapterId: string;
        targetChapterId: string;
        label: string | null;
    }

    interface Props {
        skillName: string;
        skillEmoji: string;
        chapters: ChapterData[];
        edges: EdgeData[];
        poolToolIds: string[];
        onClose: () => void;
    }

    let {
        skillName,
        skillEmoji,
        chapters,
        edges,
        poolToolIds,
        onClose,
    }: Props = $props();

    // ── Topological Sort (Kahn's algorithm) ──────────────────────────────────
    function topoSort(chs: ChapterData[], eds: EdgeData[]): string[] {
        const inDegree = new SvelteMap<string, number>();
        const adj = new SvelteMap<string, string[]>();
        for (const ch of chs) {
            inDegree.set(ch.id, 0);
            adj.set(ch.id, []);
        }
        for (const e of eds) {
            adj.get(e.sourceChapterId)?.push(e.targetChapterId);
            inDegree.set(
                e.targetChapterId,
                (inDegree.get(e.targetChapterId) ?? 0) + 1,
            );
        }
        const queue = chs
            .filter((ch) => (inDegree.get(ch.id) ?? 0) === 0)
            .map((ch) => ch.id);
        const order: string[] = [];
        while (queue.length > 0) {
            const id = queue.shift()!;
            order.push(id);
            for (const next of adj.get(id) ?? []) {
                inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
                if (inDegree.get(next) === 0) queue.push(next);
            }
        }
        return order;
    }

    // ── Cycle detection ──────────────────────────────────────────────────────
    function hasCycle(chs: ChapterData[], eds: EdgeData[]): boolean {
        return topoSort(chs, eds).length < chs.length;
    }

    // ── Build adjacency maps ─────────────────────────────────────────────────
    function buildOutgoing(eds: EdgeData[]): SvelteMap<string, EdgeData[]> {
        const m = new SvelteMap<string, EdgeData[]>();
        for (const e of eds) {
            if (!m.has(e.sourceChapterId)) m.set(e.sourceChapterId, []);
            m.get(e.sourceChapterId)!.push(e);
        }
        return m;
    }

    function buildIncoming(eds: EdgeData[]): SvelteMap<string, EdgeData[]> {
        const m = new SvelteMap<string, EdgeData[]>();
        for (const e of eds) {
            if (!m.has(e.targetChapterId)) m.set(e.targetChapterId, []);
            m.get(e.targetChapterId)!.push(e);
        }
        return m;
    }

    // ── Derived state ────────────────────────────────────────────────────────
    const sortedIds = $derived(topoSort(chapters, edges));
    const chapterMap = $derived(
        new SvelteMap(chapters.map((ch) => [ch.id, ch] as const)),
    );
    const outgoing = $derived(buildOutgoing(edges));
    const incoming = $derived(buildIncoming(edges));
    const isCyclic = $derived(hasCycle(chapters, edges));

    // Validation checks
    const allHaveGuide = $derived(
        chapters.length > 0 && chapters.every((ch) => ch.guide.trim().length > 0),
    );
    const allHaveOutput = $derived(
        chapters.length > 0 && chapters.every((ch) => ch.outputDef.trim().length > 0),
    );
    const allHaveTools = $derived(poolToolIds.length > 0);

    const chaptersWithoutGuide = $derived(
        chapters.filter((ch) => !ch.guide.trim()),
    );
    const chaptersWithoutOutput = $derived(
        chapters.filter((ch) => !ch.outputDef.trim()),
    );
    const chaptersWithoutDescription = $derived(
        chapters.filter((ch) => !ch.description.trim()),
    );

    // Helper: get the number of outgoing edges for a chapter
    function outCount(chId: string): number {
        return outgoing.get(chId)?.length ?? 0;
    }

    // Helper: get the number of incoming edges for a chapter
    function inCount(chId: string): number {
        return incoming.get(chId)?.length ?? 0;
    }

    function handleBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget) onClose();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" onclick={handleBackdropClick}>
    <div class="modal" role="dialog" aria-label="Skill Preview: {skillName}">
        <!-- Header -->
        <div class="modal-header">
            <h2 class="modal-title">
                Preview: {skillEmoji} {skillName}
            </h2>
            <button class="close-btn" onclick={onClose} aria-label="Close preview">
                <X size={18} />
            </button>
        </div>

        <!-- Scrollable content -->
        <div class="modal-body">
            {#if chapters.length === 0}
                <div class="empty-state">
                    No chapters defined. Add chapters to preview the execution path.
                </div>
            {:else}
                <!-- Pipeline Overview -->
                <div class="section-label">Execution Path</div>
                <div class="pipeline">
                    {#each sortedIds as chId, i (chId)}
                        {@const ch = chapterMap.get(chId)}
                        {@const isFork = outCount(chId) > 1}
                        {@const isMerge = inCount(chId) > 1}
                        {@const outEdges = outgoing.get(chId) ?? []}

                        {#if ch}
                            <!-- Merge indicator -->
                            {#if isMerge}
                                <div class="merge-indicator">
                                    <span class="merge-label">merge</span>
                                    <div class="merge-lines">
                                        {#each incoming.get(chId) ?? [] as inc (inc.id)}
                                            <div class="merge-line"></div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}

                            <!-- Chapter card -->
                            <div class="chapter-card" class:fork={isFork} class:merge={isMerge}>
                                <div class="chapter-number">{i + 1}</div>
                                <div class="chapter-content">
                                    <div class="chapter-name">{ch.name}</div>
                                    {#if poolToolIds.length > 0}
                                        <div class="chapter-tools">
                                            <span class="tool-icon-inline">&#9881;</span>
                                            {poolToolIds
                                                .map((tid) => getToolInfo(tid).name)
                                                .join(", ")}
                                        </div>
                                    {/if}
                                    {#if ch.guide.trim()}
                                        <div class="chapter-guide">
                                            Guide: "{ch.guide.trim().split("\n")[0].slice(0, 80)}{ch.guide.trim().split("\n")[0].length > 80 ? "..." : ""}"
                                        </div>
                                    {:else}
                                        <div class="chapter-guide chapter-guide--empty">
                                            Guide: (empty)
                                        </div>
                                    {/if}
                                    {#if ch.outputDef.trim()}
                                        <div class="chapter-output">
                                            Outputs: {ch.outputDef.trim().split("\n")[0].slice(0, 60)}{ch.outputDef.trim().split("\n")[0].length > 60 ? "..." : ""}
                                        </div>
                                    {:else}
                                        <div class="chapter-output chapter-output--empty">
                                            Outputs: (not defined)
                                        </div>
                                    {/if}
                                </div>
                            </div>

                            <!-- Connector -->
                            {#if i < sortedIds.length - 1}
                                {#if isFork}
                                    <!-- Fork: show branches side by side -->
                                    <div class="fork-connector">
                                        {#each outEdges as edge (edge.id)}
                                            <div class="fork-branch">
                                                <div class="connector-line"></div>
                                                {#if edge.label}
                                                    <span class="edge-label">{edge.label}</span>
                                                {/if}
                                                <ArrowDown size={14} class="connector-arrow" />
                                            </div>
                                        {/each}
                                    </div>
                                {:else}
                                    <!-- Single connector -->
                                    <div class="connector">
                                        <div class="connector-line"></div>
                                        {#if outEdges.length === 1 && outEdges[0].label}
                                            <span class="edge-label">{outEdges[0].label}</span>
                                        {/if}
                                        <ArrowDown size={14} class="connector-arrow" />
                                    </div>
                                {/if}
                            {/if}
                        {/if}
                    {/each}
                </div>

                <!-- Chapters not in sorted order (cycle remnants) -->
                {#if isCyclic}
                    {@const orphaned = chapters.filter(
                        (ch) => !sortedIds.includes(ch.id),
                    )}
                    {#if orphaned.length > 0}
                        <div class="cycle-warning">
                            <AlertTriangle size={14} />
                            <span>
                                {orphaned.length} chapter{orphaned.length === 1
                                    ? ""
                                    : "s"} in cycle:
                                {orphaned.map((ch) => ch.name).join(", ")}
                            </span>
                        </div>
                    {/if}
                {/if}
            {/if}

            <!-- Validation Checklist -->
            <div class="section-label">Validation</div>
            <div class="validation-list">
                <div class="validation-item">
                    {#if allHaveTools}
                        <span class="check-icon check-icon--pass"><Check size={14} /></span>
                    {:else}
                        <span class="check-icon check-icon--fail"><XCircle size={14} /></span>
                    {/if}
                    <span class="validation-text">All chapters have tools assigned</span>
                </div>

                <div class="validation-item">
                    {#if !isCyclic}
                        <span class="check-icon check-icon--pass"><Check size={14} /></span>
                    {:else}
                        <span class="check-icon check-icon--fail"><XCircle size={14} /></span>
                    {/if}
                    <span class="validation-text">DAG is acyclic</span>
                </div>

                <div class="validation-item">
                    {#if allHaveGuide}
                        <span class="check-icon check-icon--pass"><Check size={14} /></span>
                    {:else}
                        <span class="check-icon check-icon--fail"><XCircle size={14} /></span>
                    {/if}
                    <span class="validation-text">All chapters have guide text</span>
                </div>

                <div class="validation-item">
                    {#if allHaveOutput}
                        <span class="check-icon check-icon--pass"><Check size={14} /></span>
                    {:else}
                        <span class="check-icon check-icon--fail"><XCircle size={14} /></span>
                    {/if}
                    <span class="validation-text">All chapters have output definitions</span>
                </div>

                <!-- Warnings for chapters with empty fields -->
                {#if chaptersWithoutGuide.length > 0}
                    <div class="validation-item validation-item--warn">
                        <span class="check-icon check-icon--warn"><AlertTriangle size={14} /></span>
                        <span class="validation-text">
                            Missing guide: {chaptersWithoutGuide
                                .map((ch) => ch.name || "Untitled")
                                .join(", ")}
                        </span>
                    </div>
                {/if}
                {#if chaptersWithoutOutput.length > 0}
                    <div class="validation-item validation-item--warn">
                        <span class="check-icon check-icon--warn"><AlertTriangle size={14} /></span>
                        <span class="validation-text">
                            Missing output: {chaptersWithoutOutput
                                .map((ch) => ch.name || "Untitled")
                                .join(", ")}
                        </span>
                    </div>
                {/if}
                {#if chaptersWithoutDescription.length > 0}
                    <div class="validation-item validation-item--warn">
                        <span class="check-icon check-icon--warn"><AlertTriangle size={14} /></span>
                        <span class="validation-text">
                            Missing description: {chaptersWithoutDescription
                                .map((ch) => ch.name || "Untitled")
                                .join(", ")}
                        </span>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

<style>
    /* ── Overlay ─────────────────────────────────────────────────────────── */
    .overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    /* ── Modal ───────────────────────────────────────────────────────────── */
    .modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        width: 100%;
        max-width: 560px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: 10px;
    }

    .modal-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0;
    }

    .close-btn {
        background: transparent;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s;
        flex-shrink: 0;
    }
    .close-btn:hover {
        color: var(--color-foreground);
    }

    .modal-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        min-height: 0;
    }

    /* ── Section labels ───────────────────────────────────────────────────── */
    .section-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        margin-bottom: 12px;
    }

    .section-label:not(:first-child) {
        margin-top: 24px;
    }

    /* ── Empty state ──────────────────────────────────────────────────────── */
    .empty-state {
        text-align: center;
        color: var(--color-muted);
        font-size: 13px;
        padding: 32px 16px;
    }

    /* ── Pipeline ─────────────────────────────────────────────────────────── */
    .pipeline {
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    /* ── Chapter card ─────────────────────────────────────────────────────── */
    .chapter-card {
        display: flex;
        gap: 12px;
        width: 100%;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-left: 3px solid var(--color-accent);
        border-radius: 8px;
        padding: 12px 14px;
    }

    .chapter-number {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--color-accent);
        color: white;
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .chapter-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        flex: 1;
    }

    .chapter-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .chapter-tools {
        font-size: 11px;
        font-family: var(--font-mono);
        color: var(--color-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .tool-icon-inline {
        margin-right: 2px;
    }

    .chapter-guide {
        font-size: 11px;
        font-style: italic;
        color: var(--color-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .chapter-guide--empty {
        color: var(--color-muted-foreground);
    }

    .chapter-output {
        font-size: 11px;
        color: var(--color-accent);
    }

    .chapter-output--empty {
        color: var(--color-muted-foreground);
    }

    /* ── Connectors ───────────────────────────────────────────────────────── */
    .connector {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 4px 0;
        color: var(--color-accent);
    }

    .connector-line {
        width: 2px;
        height: 16px;
        background: var(--color-accent);
    }

    :global(.connector-arrow) {
        color: var(--color-accent);
    }

    /* ── Fork connector ───────────────────────────────────────────────────── */
    .fork-connector {
        display: flex;
        justify-content: center;
        gap: 24px;
        padding: 4px 0;
        width: 100%;
    }

    .fork-branch {
        display: flex;
        flex-direction: column;
        align-items: center;
        color: var(--color-accent);
    }

    .edge-label {
        font-size: 10px;
        color: var(--color-muted);
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 4px;
        padding: 1px 6px;
        margin: 2px 0;
    }

    /* ── Merge indicator ──────────────────────────────────────────────────── */
    .merge-indicator {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 2px 0 4px;
        width: 100%;
    }

    .merge-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        margin-bottom: 4px;
    }

    .merge-lines {
        display: flex;
        gap: 12px;
    }

    .merge-line {
        width: 2px;
        height: 12px;
        background: var(--color-accent);
        border-radius: 1px;
    }

    /* ── Cycle warning ────────────────────────────────────────────────────── */
    .cycle-warning {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        margin-top: 12px;
        background: color-mix(in srgb, var(--color-warning) 10%, var(--color-bg2));
        border: 1px solid var(--color-warning);
        border-radius: 6px;
        font-size: 12px;
        color: var(--color-warning);
    }

    /* ── Validation checklist ─────────────────────────────────────────────── */
    .validation-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .validation-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--color-foreground);
    }

    .check-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .check-icon--pass {
        color: var(--color-success);
    }

    .check-icon--fail {
        color: var(--color-destructive);
    }

    .check-icon--warn {
        color: var(--color-warning);
    }

    .validation-item--warn .validation-text {
        color: var(--color-warning);
        font-size: 12px;
    }

    .validation-text {
        line-height: 1.4;
    }
</style>
