<script lang="ts">
    import { page } from "$app/state";
    import { ArrowLeft, BookOpen, Loader2, Check, Upload, Circle, AlertTriangle, XCircle, CheckCircle2, Sparkles, GitBranch, RotateCcw } from "lucide-svelte";
    import { onMount } from "svelte";
    import posthog from "posthog-js";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import { conn } from "$lib/state/gateway";
    import type { ToolStatusEntry, ToolsStatusReport } from "$lib/types/tools";
    import { getToolInfo } from "$lib/data/tool-manifest";
    import ChapterEditor from "$lib/components/builder/ChapterEditor.svelte";
    import ChapterDAG from "$lib/components/builder/ChapterDAG.svelte";
    import EmojiPicker from "$lib/components/builder/EmojiPicker.svelte";

    const skillId = $derived(page.params.id);

    // ── Chapter editor modal state ────────────────────────────────────
    let editingChapter = $state<ChapterEntry | null>(null);
    let editingChapterToolIds = $state<string[]>([]);

    // ── Form state ──────────────────────────────────────────────────────
    let name = $state("Untitled Skill");
    let description = $state("");
    let emoji = $state("📘");
    let status: "draft" | "published" = $state("draft");
    let maxCycles = $state(3);
    let loading = $state(true);
    let saving = $state(false);
    let dirty = $state(false);
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Tool pool state (derived from chapter tools) ────────────────────
    let chapterToolMap = $state<Record<string, string[]>>({});
    const poolToolIds = $derived([...new Set(Object.values(chapterToolMap).flat())]);

    // ── Chapters state ──────────────────────────────────────────────────
    interface ChapterEntry { id: string; type?: string; name: string; description: string; guide: string; context: string; outputDef: string; conditionText?: string; positionX: number; positionY: number; }
    let chapters = $state<ChapterEntry[]>([]);
    let chapterEdges = $state<{ id: string; sourceChapterId: string; targetChapterId: string; label: string | null }[]>([]);

    // ── Gateway tools (for chapter editor tool selection) ──────────────
    let gatewayTools = $state<ToolStatusEntry[]>([]);
    const allToolIds = $derived(gatewayTools.map(t => t.id));

    async function loadGatewayTools() {
        if (!conn.connected) return;
        try {
            const report = (await sendRequest('tools.status', {})) as ToolsStatusReport;
            gatewayTools = report.tools;
        } catch (e) {
            console.error('[skill-editor] Failed to load gateway tools:', e);
        }
    }

    // ── Load skill data ─────────────────────────────────────────────────
    async function loadSkill() {
        loading = true;
        try {
            const res = await fetch(`/api/builder/skills/${skillId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            name = data.skill.name;
            description = data.skill.description ?? '';
            emoji = data.skill.emoji ?? '📘';
            status = data.skill.status;
            maxCycles = data.skill.maxCycles ?? 3;
            chapters = data.chapters;
            chapterEdges = data.edges;

            // Load chapter tools into map
            const toolMap: Record<string, string[]> = {};
            await Promise.all(data.chapters.map(async (ch: ChapterEntry) => {
                try {
                    const toolRes = await fetch(`/api/builder/skills/${skillId}/chapter-tools/${ch.id}`);
                    if (toolRes.ok) {
                        const toolData = await toolRes.json();
                        toolMap[ch.id] = toolData.toolIds ?? [];
                    } else {
                        toolMap[ch.id] = [];
                    }
                } catch {
                    toolMap[ch.id] = [];
                }
            }));
            chapterToolMap = toolMap;
        } catch (e) {
            console.error('[skill-editor] Failed to load:', e);
        } finally {
            loading = false;
        }
    }

    // ── Auto-save (debounced 2s) ─────────────────────────────────────────
    function scheduleSave() {
        dirty = true;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveSkill(), 2000);
    }

    async function saveSkill() {
        saving = true;
        try {
            await fetch(`/api/builder/skills/${skillId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, emoji, maxCycles }),
            });
            dirty = false;
        } catch (e) {
            console.error('[skill-editor] Save failed:', e);
        } finally {
            saving = false;
        }
    }

    // ── Publish ──────────────────────────────────────────────────────────
    let publishing = $state(false);

    async function publishSkill() {
        // Flush any pending save first
        if (dirty) await saveSkill();
        publishing = true;
        try {
            await fetch(`/api/builder/skills/${skillId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'publish' }),
            });
            status = 'published';
            posthog.capture('skill_published', { skill_id: skillId, skill_name: name });
        } catch (e) {
            console.error('[skill-editor] Publish failed:', e);
        } finally {
            publishing = false;
        }
    }

    // ── AI Assist: Generate full skill pipeline ─────────────────────────
    let aiBuilding = $state(false);
    let aiBuildError = $state<string | null>(null);

    async function buildSkillWithAI() {
        if (!description.trim()) return;
        aiBuilding = true;
        aiBuildError = null;

        try {
            const res = await fetch('/api/builder/ai/suggest-skill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim(),
                    availableToolIds: allToolIds,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || `Request failed (${res.status})`);
            }

            const data = await res.json();
            if (!data.chapters?.length) {
                throw new Error('AI returned no chapters');
            }

            // Create all chapters via API and collect their real IDs
            const chapterIdMap: string[] = []; // index → real ID
            const newChapters: ChapterEntry[] = [];
            const newToolMap: Record<string, string[]> = { ...chapterToolMap };

            for (const ch of data.chapters) {
                const createRes = await fetch(`/api/builder/skills/${skillId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'add-chapter',
                        name: ch.name,
                        type: ch.type ?? 'chapter',
                        conditionText: ch.conditionText ?? '',
                        positionX: ch.positionX ?? 300,
                        positionY: ch.positionY ?? 0,
                    }),
                });

                if (!createRes.ok) continue;
                const { id } = await createRes.json();
                chapterIdMap.push(id);

                newChapters.push({
                    id,
                    type: ch.type ?? 'chapter',
                    name: ch.name,
                    description: ch.description ?? '',
                    guide: ch.guide ?? '',
                    context: ch.context ?? '',
                    outputDef: ch.outputDef ?? '',
                    conditionText: ch.conditionText ?? '',
                    positionX: ch.positionX ?? 300,
                    positionY: ch.positionY ?? 0,
                });

                // Set chapter tools if provided
                const toolIds = (ch.toolIds ?? []).filter((t: string) => allToolIds.includes(t));
                if (toolIds.length > 0) {
                    await fetch(`/api/builder/skills/${skillId}/chapter-tools/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ toolIds }),
                    });
                }
                newToolMap[id] = toolIds;

                // Save chapter metadata (guide, context, outputDef)
                if (ch.guide || ch.context || ch.outputDef || ch.description) {
                    await fetch(`/api/builder/skills/${skillId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'update-chapter',
                            chapterId: id,
                            data: {
                                description: ch.description ?? '',
                                guide: ch.guide ?? '',
                                context: ch.context ?? '',
                                outputDef: ch.outputDef ?? '',
                                conditionText: ch.conditionText ?? '',
                            },
                        }),
                    });
                }
            }

            // Create edges
            const newEdges: typeof chapterEdges = [];
            for (const edge of data.edges ?? []) {
                const srcId = chapterIdMap[edge.from];
                const tgtId = chapterIdMap[edge.to];
                if (!srcId || !tgtId) continue;

                const edgeRes = await fetch(`/api/builder/skills/${skillId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'add-edge',
                        sourceChapterId: srcId,
                        targetChapterId: tgtId,
                        label: edge.label ?? null,
                    }),
                });

                if (edgeRes.ok) {
                    const { id } = await edgeRes.json();
                    newEdges.push({
                        id,
                        sourceChapterId: srcId,
                        targetChapterId: tgtId,
                        label: edge.label ?? null,
                    });
                }
            }

            // Update local state
            chapters = [...chapters, ...newChapters];
            chapterEdges = [...chapterEdges, ...newEdges];
            chapterToolMap = newToolMap;
            posthog.capture('skill_ai_generated', {
                skill_id: skillId,
                skill_name: name,
                chapters_count: newChapters.length,
            });
        } catch (e) {
            aiBuildError = e instanceof Error ? e.message : 'Failed to build skill';
            console.error('[skill-editor] AI build failed:', e);
        } finally {
            aiBuilding = false;
        }
    }

    // ── Condition node support ───────────────────────────────────────────
    let editingCondition = $state<ChapterEntry | null>(null);
    let conditionText = $state('');
    let conditionName = $state('');

    function validateConditionText(text: string): { valid: boolean; reason?: string } {
        const trimmed = text.trim();
        if (!trimmed) return { valid: false, reason: 'Condition text is required' };
        if (!trimmed.endsWith('?')) return { valid: false, reason: 'Must be a question (end with ?)' };

        const subjective = /\b(feel|feeling|think|opinion|subjective|how much|how well|how good|how bad|prefer|like|enjoy|rate|score|scale|how does|how do)\b/i;
        if (subjective.test(trimmed)) return { valid: false, reason: 'Must have a binary yes/no answer — not subjective' };

        const binary = /^(is|are|does|do|has|have|can|could|will|would|should|shall|was|were|did|had)\b/i;
        if (!binary.test(trimmed)) return { valid: false, reason: 'Start with a binary question word (Is, Does, Has, Can, Will, etc.)' };

        return { valid: true };
    }

    const conditionValidation = $derived(validateConditionText(conditionText));

    async function addCondition() {
        editingCondition = null;
        conditionText = '';
        conditionName = `Condition ${chapters.filter(c => c.type === 'condition').length + 1}`;
        editingCondition = { id: '', type: 'condition', name: conditionName, description: '', guide: '', context: '', outputDef: '', conditionText: '', positionX: 300, positionY: 100 + chapters.length * 180 };
    }

    async function saveCondition() {
        if (!conditionValidation.valid) return;

        const res = await fetch(`/api/builder/skills/${skillId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'add-chapter',
                name: conditionName || 'Condition',
                type: 'condition',
                conditionText,
                positionX: 300,
                positionY: 100 + chapters.length * 180,
            }),
        });

        if (res.ok) {
            const { id } = await res.json();
            chapters = [...chapters, {
                id,
                type: 'condition',
                name: conditionName || 'Condition',
                description: '',
                guide: '',
                context: '',
                outputDef: '',
                conditionText,
                positionX: 300,
                positionY: 100 + (chapters.length - 1) * 180,
            }];
            chapterToolMap = { ...chapterToolMap, [id]: [] };
        }
        editingCondition = null;
    }

    function openConditionOrChapter(chapter: ChapterEntry) {
        if (chapter.type === 'condition') {
            editingCondition = chapter;
            conditionText = chapter.conditionText ?? '';
            conditionName = chapter.name;
        } else {
            openChapterEditor(chapter);
        }
    }

    async function updateCondition() {
        if (!editingCondition || !editingCondition.id || !conditionValidation.valid) return;

        await fetch(`/api/builder/skills/${skillId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'update-chapter',
                chapterId: editingCondition.id,
                data: { name: conditionName, conditionText },
            }),
        });

        chapters = chapters.map(c => c.id === editingCondition!.id ? { ...c, name: conditionName, conditionText } : c);
        editingCondition = null;
    }

    // ── Chapter actions ──────────────────────────────────────────────────
    async function addChapter() {
        const chapterName = `Chapter ${chapters.length + 1}`;
        const res = await fetch(`/api/builder/skills/${skillId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add-chapter', name: chapterName, positionX: 100 + chapters.length * 200, positionY: 100 }),
        });
        if (res.ok) {
            const { id } = await res.json();
            chapters = [...chapters, { id, name: chapterName, description: '', guide: '', context: '', outputDef: '', positionX: 100 + (chapters.length - 1) * 200, positionY: 100 }];
            chapterToolMap = { ...chapterToolMap, [id]: [] };
        }
    }

    async function removeChapter(chapterId: string) {
        await fetch(`/api/builder/skills/${skillId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete-chapter', chapterId }),
        });
        chapters = chapters.filter(c => c.id !== chapterId);
        chapterEdges = chapterEdges.filter(e => e.sourceChapterId !== chapterId && e.targetChapterId !== chapterId);
        const { [chapterId]: _, ...restToolMap } = chapterToolMap;
        chapterToolMap = restToolMap;
    }

    // ── Chapter position update (from DAG drag) ──────────────────────
    async function updateChapterPosition(chapterId: string, x: number, y: number) {
        chapters = chapters.map(c => c.id === chapterId ? { ...c, positionX: x, positionY: y } : c);
        await fetch(`/api/builder/skills/${skillId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update-chapter', chapterId, data: { positionX: x, positionY: y } }),
        });
    }

    // ── Chapter edge creation ────────────────────────────────────────
    async function connectChapters(sourceId: string, targetId: string, label?: string) {
        const res = await fetch(`/api/builder/skills/${skillId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add-edge', sourceChapterId: sourceId, targetChapterId: targetId, label: label ?? null }),
        });
        if (res.ok) {
            const { id } = await res.json();
            chapterEdges = [...chapterEdges, { id, sourceChapterId: sourceId, targetChapterId: targetId, label: label ?? null }];
        }
    }

    async function deleteEdge(edgeId: string) {
        await fetch(`/api/builder/skills/${skillId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete-edge', edgeId }),
        });
        chapterEdges = chapterEdges.filter(e => e.id !== edgeId);
    }

    // ── Chapter delete confirmation ─────────────────────────────────
    let chapterToDelete = $state<ChapterEntry | null>(null);

    function confirmRemoveChapter(chapter: ChapterEntry) {
        chapterToDelete = chapter;
    }

    async function executeDeleteChapter() {
        if (!chapterToDelete) return;
        await removeChapter(chapterToDelete.id);
        chapterToDelete = null;
    }

    // ── Chapter editor ────────────────────────────────────────────────
    function openChapterEditor(chapter: ChapterEntry) {
        editingChapter = chapter;
        editingChapterToolIds = chapterToolMap[chapter.id] ?? [];
    }

    async function saveChapterEdits(data: { name: string; description: string; guide: string; context: string; outputDef: string; toolIds: string[] }) {
        if (!editingChapter) return;
        const chapterId = editingChapter.id;

        saving = true;
        try {
            // Save chapter metadata
            await fetch(`/api/builder/skills/${skillId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'update-chapter', chapterId, data: { name: data.name, description: data.description, guide: data.guide, context: data.context, outputDef: data.outputDef } }),
            });

            // Save chapter tools
            await fetch(`/api/builder/skills/${skillId}/chapter-tools/${chapterId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolIds: data.toolIds }),
            });

            // Update local state
            chapters = chapters.map(c => c.id === chapterId ? { ...c, name: data.name, description: data.description, guide: data.guide, context: data.context, outputDef: data.outputDef } : c);
            chapterToolMap = { ...chapterToolMap, [chapterId]: data.toolIds };
        } catch (e) {
            console.error('[skill-editor] Save chapter failed:', e);
        } finally {
            saving = false;
            editingChapter = null;
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────
    onMount(() => {
        loadSkill();
        loadGatewayTools();
    });

    // Reload tools when gateway connects
    $effect(() => {
        if (conn.connected) loadGatewayTools();
    });

    // Trigger auto-save on field changes
    $effect(() => {
        // Access reactive values to track them
        void name; void description; void emoji;
        if (!loading) scheduleSave();
    });

    // ── Validation ──────────────────────────────────────────────────────
    interface ValidationFinding {
        level: 'error' | 'warning' | 'ok';
        message: string;
    }

    const validationFindings = $derived.by(() => {
        const findings: ValidationFinding[] = [];

        // Check skill has a name
        if (!name.trim() || name.trim() === 'Untitled Skill') {
            findings.push({ level: 'warning', message: 'Skill has no custom name' });
        } else {
            findings.push({ level: 'ok', message: 'Skill has a name' });
        }

        // Check skill has a description
        if (!description.trim()) {
            findings.push({ level: 'warning', message: 'Skill has no description' });
        } else {
            findings.push({ level: 'ok', message: 'Skill has a description' });
        }

        // Check at least one chapter exists
        if (chapters.length === 0) {
            findings.push({ level: 'error', message: 'No chapters defined' });
        } else {
            findings.push({ level: 'ok', message: `${chapters.length} chapter${chapters.length !== 1 ? 's' : ''} defined` });
        }

        // Check chapters have tools assigned
        const chaptersWithoutTools = chapters.filter(ch => !(chapterToolMap[ch.id]?.length));
        if (chaptersWithoutTools.length > 0) {
            findings.push({ level: 'warning', message: `${chaptersWithoutTools.length} chapter${chaptersWithoutTools.length !== 1 ? 's' : ''} without tools` });
        } else if (chapters.length > 0) {
            findings.push({ level: 'ok', message: 'All chapters have tools' });
        }

        // Check chapters have guide text
        const chaptersWithoutGuide = chapters.filter(ch => !ch.guide?.trim());
        if (chaptersWithoutGuide.length > 0) {
            findings.push({ level: 'warning', message: `${chaptersWithoutGuide.length} chapter${chaptersWithoutGuide.length !== 1 ? 's' : ''} without instructions` });
        } else if (chapters.length > 0) {
            findings.push({ level: 'ok', message: 'All chapters have instructions' });
        }

        // Check chapters have output definitions
        const chaptersWithoutOutput = chapters.filter(ch => !ch.outputDef?.trim());
        if (chaptersWithoutOutput.length > 0) {
            findings.push({ level: 'warning', message: `${chaptersWithoutOutput.length} chapter${chaptersWithoutOutput.length !== 1 ? 's' : ''} without output definitions` });
        } else if (chapters.length > 0) {
            findings.push({ level: 'ok', message: 'All chapters have output definitions' });
        }

        // Check DAG is connected (has edges if >1 chapter)
        if (chapters.length > 1 && chapterEdges.length === 0) {
            findings.push({ level: 'warning', message: 'Chapters are not connected (no edges)' });
        } else if (chapters.length > 1) {
            findings.push({ level: 'ok', message: 'Chapter flow is connected' });
        }

        // Check for cycles in the DAG
        if (chapters.length > 1 && chapterEdges.length > 0) {
            const adj = new Map<string, string[]>();
            for (const ch of chapters) adj.set(ch.id, []);
            for (const e of chapterEdges) adj.get(e.sourceChapterId)?.push(e.targetChapterId);
            const visited = new Set<string>();
            const stack = new Set<string>();
            let hasCycle = false;
            function dfs(node: string) {
                if (hasCycle) return;
                visited.add(node);
                stack.add(node);
                for (const neighbor of adj.get(node) ?? []) {
                    if (stack.has(neighbor)) { hasCycle = true; return; }
                    if (!visited.has(neighbor)) dfs(neighbor);
                }
                stack.delete(node);
            }
            for (const ch of chapters) {
                if (!visited.has(ch.id)) dfs(ch.id);
            }
            if (hasCycle) {
                findings.push({ level: 'ok', message: `Cycle detected — max ${maxCycles} iteration${maxCycles !== 1 ? 's' : ''}` });
            } else {
                findings.push({ level: 'ok', message: 'Chapter graph is acyclic' });
            }
        }

        return findings;
    });

    const validationCounts = $derived({
        errors: validationFindings.filter(f => f.level === 'error').length,
        warnings: validationFindings.filter(f => f.level === 'warning').length,
        ok: validationFindings.filter(f => f.level === 'ok').length,
    });

    const worstLevel = $derived<'error' | 'warning' | 'ok'>(
        validationCounts.errors > 0 ? 'error' : validationCounts.warnings > 0 ? 'warning' : 'ok'
    );

    let showValidation = $state(false);

    const validationTooltip = $derived(
        [
            validationCounts.errors > 0 ? `${validationCounts.errors} error${validationCounts.errors !== 1 ? 's' : ''}` : '',
            validationCounts.warnings > 0 ? `${validationCounts.warnings} warning${validationCounts.warnings !== 1 ? 's' : ''}` : '',
            validationCounts.ok > 0 ? `${validationCounts.ok} ok` : '',
        ].filter(Boolean).join(', ')
    );
</script>

<!-- ── Skill Editor Toolbar ─────────────────────────────────────── -->
    <div class="editor-toolbar">
        <div class="flex items-center gap-3 min-w-0">
            <a href="/builder" class="back-link" title="Back to Builder">
                <ArrowLeft size={16} />
            </a>

            <div class="h-5 w-px bg-border/60 shrink-0"></div>

            <div class="flex items-center gap-2 min-w-0">
                <BookOpen size={16} class="text-accent shrink-0" />
                <span class="text-sm font-semibold text-foreground truncate">
                    {name}
                </span>
                <span class="status-badge {status}">
                    {status}
                </span>
            </div>
        </div>

        <div class="flex items-center gap-2">
            <!-- Save status indicator -->
            <span class="save-indicator" title={saving ? 'Saving changes...' : dirty ? 'Unsaved changes' : 'All changes saved'}>
                {#if saving}
                    <Loader2 size={12} class="loading-spinner" />
                    <span>Saving...</span>
                {:else if dirty}
                    <Circle size={8} class="dirty-dot" />
                    <span>Unsaved</span>
                {:else}
                    <Check size={12} class="saved-check" />
                    <span>Saved</span>
                {/if}
            </span>

            <div class="h-4 w-px bg-border/60"></div>

            <label class="max-cycles-control" title="Maximum cycle iterations allowed at runtime">
                <RotateCcw size={12} class="max-cycles-icon" />
                <input
                    type="number"
                    min="1"
                    max="20"
                    class="max-cycles-input"
                    value={maxCycles}
                    oninput={(e) => { maxCycles = Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1); scheduleSave(); }}
                />
            </label>

            <div class="h-4 w-px bg-border/60"></div>

            <button
                type="button"
                class="toolbar-btn validation-btn {worstLevel}"
                title={validationTooltip}
                onclick={() => { showValidation = !showValidation; }}
            >
                {#if worstLevel === 'error'}
                    <XCircle size={14} />
                {:else if worstLevel === 'warning'}
                    <AlertTriangle size={14} />
                {:else}
                    <CheckCircle2 size={14} />
                {/if}
                <span class="hidden sm:inline">Validation</span>
            </button>
            <button
                type="button"
                class="toolbar-btn {status === 'published' ? 'published' : 'primary'}"
                onclick={publishSkill}
                disabled={publishing}
                title={status === 'published' ? 'Republish with latest changes' : 'Publish to shared space'}
            >
                {#if publishing}
                    <Loader2 size={14} class="loading-spinner" />
                {:else}
                    <Upload size={14} />
                {/if}
                <span class="hidden sm:inline">{publishing ? 'Publishing...' : status === 'published' ? 'Republish' : 'Publish'}</span>
            </button>
        </div>
    </div>

    <!-- ── Three-Column Book Layout ─────────────────────────────────── -->
    <div class="flex-1 min-h-0 flex">

        <!-- The "Open Book" spread -->
        <div class="book-spread">

            <!-- Book Left Page: Metadata -->
            <section class="book-page book-page-left">
                {#if loading}
                    <div class="flex items-center justify-center h-full">
                        <span class="text-muted text-sm">Loading...</span>
                    </div>
                {:else}
                    <div class="page-content">
                        <!-- Emoji + Name -->
                        <div class="name-row">
                            <EmojiPicker value={emoji} onSelect={(e) => { emoji = e; }} />
                            <input
                                type="text"
                                class="name-input"
                                bind:value={name}
                                placeholder="Skill name"
                            />
                        </div>

                        <!-- Description -->
                        <textarea
                            class="desc-input"
                            bind:value={description}
                            placeholder="Describe what this skill does..."
                            rows="3"
                        ></textarea>

                        <!-- AI Assist: Build entire skill from description -->
                        {#if description.trim().length >= 10}
                            <div class="ai-assist-section">
                                <button
                                    type="button"
                                    class="ai-assist-btn"
                                    onclick={buildSkillWithAI}
                                    disabled={aiBuilding}
                                >
                                    {#if aiBuilding}
                                        <Loader2 size={14} class="loading-spinner" />
                                        <span>Building skill pipeline...</span>
                                    {:else}
                                        <Sparkles size={14} />
                                        <span>Build chapters with AI</span>
                                    {/if}
                                </button>
                                {#if aiBuildError}
                                    <span class="ai-assist-error">{aiBuildError}</span>
                                {/if}
                            </div>
                        {/if}

                        <!-- Tool Pool (read-only, aggregated from chapters) -->
                        <div class="tool-pool-section">
                            <h3 class="section-label">Tool Pool <span class="pool-count">{poolToolIds.length}</span></h3>
                            <p class="section-sublabel">
                                Tools used across chapters
                            </p>
                            <div
                                class="tool-pool-drop"
                                class:has-tools={poolToolIds.length > 0}
                                role="list"
                            >
                                {#if poolToolIds.length === 0}
                                    <span class="pool-empty-text">
                                        No tools assigned in any chapter yet
                                    </span>
                                {:else}
                                    {#each poolToolIds as toolId (toolId)}
                                        {@const info = getToolInfo(toolId)}
                                        <div class="pool-card" role="listitem">
                                            <div class="pool-card-top">
                                                <span class="pool-card-icon">{info.icon}</span>
                                                <div class="pool-card-text">
                                                    <span class="pool-card-name">{info.name}</span>
                                                    <span class="pool-card-cat">{info.category}</span>
                                                </div>
                                            </div>
                                            <p class="pool-card-desc">{info.description}</p>
                                        </div>
                                    {/each}
                                {/if}
                            </div>
                        </div>
                    </div>
                {/if}
            </section>

            <!-- Book Spine Divider -->
            <div class="book-spine"></div>

            <!-- Book Right Page: DAG / Subprocesses -->
            <section class="book-page book-page-right dag-page">
                <ChapterDAG
                    {chapters}
                    edges={chapterEdges}
                    onChapterClick={openConditionOrChapter}
                    onChapterPositionChange={updateChapterPosition}
                    onAddChapter={addChapter}
                    onAddCondition={addCondition}
                    onDeleteChapter={(ch) => confirmRemoveChapter(ch)}
                    onConnect={connectChapters}
                    onDeleteEdge={deleteEdge}
                />
            </section>

        </div>
    </div>

{#if chapterToDelete}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" role="dialog" aria-modal="true" onclick={(e) => { if (e.target === e.currentTarget) chapterToDelete = null; }} onkeydown={(e) => { if (e.key === 'Escape') chapterToDelete = null; }}>
        <div class="confirm-modal">
            <p class="confirm-title">Delete "{chapterToDelete.name}"?</p>
            <p class="confirm-desc">This chapter and its configuration will be permanently removed.</p>
            <div class="confirm-actions">
                <button type="button" class="confirm-btn cancel" onclick={() => { chapterToDelete = null; }}>Cancel</button>
                <button type="button" class="confirm-btn delete" onclick={executeDeleteChapter}>Delete</button>
            </div>
        </div>
    </div>
{/if}

{#if editingChapter}
    <ChapterEditor
        chapter={editingChapter}
        availableToolIds={allToolIds}
        chapterToolIds={editingChapterToolIds}
        skillName={name}
        skillDescription={description}
        onSave={saveChapterEdits}
        onClose={() => { editingChapter = null; }}
    />
{/if}

{#if showValidation}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" role="dialog" aria-modal="true" onclick={(e) => { if (e.target === e.currentTarget) showValidation = false; }} onkeydown={(e) => { if (e.key === 'Escape') showValidation = false; }}>
        <div class="validation-modal">
            <div class="validation-header">
                <span class="validation-title">Skill Validation</span>
                <button type="button" class="close-btn" onclick={() => { showValidation = false; }} aria-label="Close">×</button>
            </div>
            <div class="validation-body">
                {#each validationFindings as finding}
                    <div class="validation-row {finding.level}">
                        {#if finding.level === 'error'}
                            <XCircle size={14} class="validation-icon error" />
                        {:else if finding.level === 'warning'}
                            <AlertTriangle size={14} class="validation-icon warning" />
                        {:else}
                            <CheckCircle2 size={14} class="validation-icon ok" />
                        {/if}
                        <span>{finding.message}</span>
                    </div>
                {/each}
            </div>
            <div class="validation-footer">
                <span class="validation-summary">
                    {validationCounts.errors} error{validationCounts.errors !== 1 ? 's' : ''},
                    {validationCounts.warnings} warning{validationCounts.warnings !== 1 ? 's' : ''},
                    {validationCounts.ok} ok
                </span>
                <button type="button" class="confirm-btn cancel" onclick={() => { showValidation = false; }}>Close</button>
            </div>
        </div>
    </div>
{/if}

{#if editingCondition}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" role="dialog" aria-modal="true" onclick={(e) => { if (e.target === e.currentTarget) { editingCondition = null; } }} onkeydown={(e) => { if (e.key === 'Escape') { editingCondition = null; } }}>
        <div class="condition-modal">
            <div class="condition-modal-header">
                <GitBranch size={16} class="condition-icon" />
                <span class="condition-modal-title">{editingCondition.id ? 'Edit Condition' : 'New Condition'}</span>
                <button type="button" class="close-btn" onclick={() => { editingCondition = null; }} aria-label="Close">×</button>
            </div>
            <div class="condition-modal-body">
                <div class="condition-field">
                    <label class="condition-label" for="cond-name">Label</label>
                    <input id="cond-name" type="text" class="condition-input" bind:value={conditionName} placeholder="e.g. Sufficient Data?" />
                </div>
                <div class="condition-field">
                    <label class="condition-label" for="cond-text">Condition <span class="required">*</span></label>
                    <span class="condition-helper">Binary yes/no question the agent evaluates at runtime</span>
                    <input
                        id="cond-text"
                        type="text"
                        class="condition-input"
                        class:invalid={conditionText.trim().length > 0 && !conditionValidation.valid}
                        class:valid-input={conditionValidation.valid}
                        bind:value={conditionText}
                        placeholder="Is the user authenticated?"
                    />
                    {#if conditionText.trim().length > 0 && !conditionValidation.valid}
                        <span class="condition-error">
                            <XCircle size={12} />
                            {conditionValidation.reason}
                        </span>
                    {:else if conditionValidation.valid}
                        <span class="condition-valid">
                            <CheckCircle2 size={12} />
                            Valid binary condition
                        </span>
                    {/if}
                </div>
            </div>
            <div class="condition-modal-footer">
                <button type="button" class="confirm-btn cancel" onclick={() => { editingCondition = null; }}>Cancel</button>
                <button
                    type="button"
                    class="confirm-btn primary"
                    disabled={!conditionValidation.valid}
                    onclick={editingCondition.id ? updateCondition : saveCondition}
                >{editingCondition.id ? 'Update' : 'Create'}</button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* ── Editor Toolbar ──────────────────────────────────────────────── */
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 2.75rem;
        padding: 0 0.75rem;
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .back-link {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 0.375rem;
        color: var(--color-muted);
        transition: all 0.15s ease;
    }

    .back-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        flex-shrink: 0;
    }

    .status-badge.draft {
        color: var(--color-warning);
        background: color-mix(in srgb, var(--color-warning) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-warning) 25%, transparent);
    }

    .status-badge.published {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
    }

    .toolbar-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.625rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .toolbar-btn.secondary {
        color: var(--color-muted);
        background: transparent;
        border: 1px solid var(--color-border);
    }

    .toolbar-btn.secondary:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .toolbar-btn.primary {
        color: white;
        background: var(--color-accent);
    }

    .toolbar-btn.primary:hover {
        filter: brightness(1.1);
    }

    .toolbar-btn.published {
        color: var(--color-success, #22c55e);
        background: color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success, #22c55e) 25%, transparent);
    }

    .toolbar-btn.published:hover {
        background: color-mix(in srgb, var(--color-success, #22c55e) 20%, transparent);
    }

    /* ── Save Indicator ────────────────────────────────────────────── */
    .save-indicator {
        display: flex;
        align-items: center;
        gap: 0.3125rem;
        font-size: 0.6875rem;
        color: var(--color-muted);
        white-space: nowrap;
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        user-select: none;
    }

    :global(.dirty-dot) {
        color: var(--color-warning, #f59e0b);
        fill: var(--color-warning, #f59e0b);
    }

    :global(.saved-check) {
        color: var(--color-success, #22c55e);
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    /* ── Book Spread ─────────────────────────────────────────────────── */
    .book-spread {
        flex: 1;
        display: flex;
        min-width: 0;
    }

    .book-page {
        flex: 1;
        overflow-y: auto;
        min-width: 0;
    }

    .book-page-left {
        background: var(--color-bg);
    }

    .book-page-right {
        background: color-mix(in srgb, var(--color-bg2) 30%, var(--color-bg));
    }

    .dag-page {
        padding: 0;
        position: relative;
    }

    .book-spine {
        width: 1px;
        background: var(--color-border);
        flex-shrink: 0;
        position: relative;
    }

    .book-spine::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: -3px;
        right: -3px;
        background: linear-gradient(
            to right,
            transparent,
            color-mix(in srgb, var(--color-border) 20%, transparent) 40%,
            color-mix(in srgb, var(--color-border) 40%, transparent) 50%,
            color-mix(in srgb, var(--color-border) 20%, transparent) 60%,
            transparent
        );
        pointer-events: none;
    }

    .page-content {
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    /* ── Emoji Picker ────────────────────────────────────────────────── */
    .emoji-picker {
        width: 3.5rem;
        height: 3.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 0.75rem;
        border: 2px dashed var(--color-border);
        background: var(--color-bg2);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .emoji-picker:hover {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    }

    .emoji-display {
        font-size: 1.75rem;
        line-height: 1;
    }

    /* ── Name Row ───────────────────────────────────────────────────── */
    .name-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .name-input {
        flex: 1;
        width: 100%;
        font-size: 1.25rem;
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

    .name-input:focus {
        border-bottom-color: var(--color-accent);
    }

    .name-input::placeholder {
        color: var(--color-muted);
    }

    /* ── Description Textarea ────────────────────────────────────────── */
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

    .desc-input:focus {
        border-color: var(--color-accent);
    }

    .desc-input::placeholder {
        color: var(--color-muted);
    }

    /* ── Tool Pool Section ───────────────────────────────────────────── */
    .section-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
    }

    .section-sublabel {
        font-size: 0.6875rem;
        color: var(--color-muted-foreground);
        margin-top: -0.5rem;
    }

    .tool-pool-section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.5rem;
    }

    .pool-count {
        font-size: 0.5625rem;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 9999px;
        margin-left: 0.25rem;
        font-weight: 500;
        vertical-align: middle;
    }

    .tool-pool-drop {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        min-height: 3.5rem;
        border: 2px dashed var(--color-border);
        border-radius: 0.5rem;
        padding: 0.625rem;
        transition: all 0.15s ease;
    }

    .tool-pool-drop.has-tools {
        border-style: solid;
        border-color: var(--color-border);
    }

    .pool-empty-text {
        font-size: 0.6875rem;
        color: var(--color-muted);
        width: 100%;
        text-align: center;
    }

    .pool-card {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.5rem 0.625rem;
        border-radius: 0.5rem;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        transition: all 0.1s ease;
        width: 100%;
    }

    .pool-card:hover {
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    }

    .pool-card-top {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .pool-card-icon {
        font-size: 1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .pool-card-text {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 0.375rem;
    }

    .pool-card-name {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-foreground);
        white-space: nowrap;
    }

    .pool-card-cat {
        font-size: 0.5625rem;
        color: var(--color-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.7;
    }

    .pool-card-desc {
        font-size: 0.625rem;
        color: var(--color-muted);
        line-height: 1.35;
        margin: 0;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    /* ── Chapters / DAG (Right Page) ─────────────────────────────────── */
    .chapters-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 12rem;
        border: 2px dashed var(--color-border);
        border-radius: 0.5rem;
        padding: 1.5rem;
        margin-top: 0.5rem;
    }

    .add-chapter-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        margin-top: 1rem;
        padding: 0.375rem 0.75rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .add-chapter-btn:hover {
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    }

    /* (Chapter cards replaced by ChapterDAG canvas) */

    /* ── Delete Confirmation Modal ─────────────────────────────────── */
    .confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: 1100;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .confirm-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        padding: 1.25rem 1.5rem;
        max-width: 340px;
        width: 100%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    }

    .confirm-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0 0 0.375rem;
    }

    .confirm-desc {
        font-size: 0.75rem;
        color: var(--color-muted);
        margin: 0 0 1rem;
        line-height: 1.4;
    }

    .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }

    .confirm-btn {
        font-family: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.375rem 0.875rem;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
    }

    .confirm-btn.cancel {
        background: var(--color-bg2);
        color: var(--color-muted);
        border: 1px solid var(--color-border);
    }

    .confirm-btn.cancel:hover {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }

    .confirm-btn.delete {
        background: var(--color-error, #ef4444);
        color: white;
    }

    .confirm-btn.delete:hover {
        filter: brightness(1.1);
    }

    /* ── Validation Button ───────────────────────────────────────────── */
    .validation-btn.error {
        color: var(--color-error, #ef4444);
        border-color: color-mix(in srgb, var(--color-error, #ef4444) 30%, var(--color-border));
        background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
    }

    .validation-btn.error:hover {
        background: color-mix(in srgb, var(--color-error, #ef4444) 15%, transparent);
    }

    .validation-btn.warning {
        color: var(--color-warning, #f59e0b);
        border-color: color-mix(in srgb, var(--color-warning, #f59e0b) 30%, var(--color-border));
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent);
    }

    .validation-btn.warning:hover {
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent);
    }

    .validation-btn.ok {
        color: var(--color-success, #22c55e);
        border-color: color-mix(in srgb, var(--color-success, #22c55e) 30%, var(--color-border));
        background: color-mix(in srgb, var(--color-success, #22c55e) 8%, transparent);
    }

    .validation-btn.ok:hover {
        background: color-mix(in srgb, var(--color-success, #22c55e) 15%, transparent);
    }

    /* ── Max Cycles Control ──────────────────────────────────────────── */
    .max-cycles-control {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        cursor: default;
        color: var(--color-muted);
        font-size: 0.7rem;
    }

    .max-cycles-icon {
        opacity: 0.7;
        flex-shrink: 0;
    }

    .max-cycles-input {
        width: 2.5rem;
        padding: 0.2rem 0.3rem;
        font-size: 0.7rem;
        font-family: inherit;
        text-align: center;
        background: var(--color-bg2, #1a1a2e);
        border: 1px solid var(--color-border);
        border-radius: 0.25rem;
        color: var(--color-foreground);
        appearance: textfield;
        -moz-appearance: textfield;
    }

    .max-cycles-input::-webkit-inner-spin-button,
    .max-cycles-input::-webkit-outer-spin-button {
        -webkit-appearance: none;
    }

    .max-cycles-input:focus {
        outline: none;
        border-color: var(--color-accent);
    }

    /* ── Validation Modal ────────────────────────────────────────────── */
    .validation-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        max-width: 420px;
        width: 100%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
        display: flex;
        flex-direction: column;
    }

    .validation-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.875rem 1.25rem;
        border-bottom: 1px solid var(--color-border);
    }

    .validation-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-foreground);
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        font-size: 1.125rem;
        line-height: 1;
        padding: 0.25rem;
        border-radius: 0.25rem;
        transition: color 0.15s ease;
    }

    .close-btn:hover {
        color: var(--color-foreground);
    }

    .validation-body {
        padding: 0.75rem 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        max-height: 50vh;
        overflow-y: auto;
    }

    .validation-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.5rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        color: var(--color-foreground);
    }

    .validation-row.error {
        background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
    }

    .validation-row.warning {
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent);
    }

    .validation-row.ok {
        background: color-mix(in srgb, var(--color-success, #22c55e) 6%, transparent);
        color: var(--color-muted);
    }

    :global(.validation-icon.error) {
        color: var(--color-error, #ef4444);
        flex-shrink: 0;
    }

    :global(.validation-icon.warning) {
        color: var(--color-warning, #f59e0b);
        flex-shrink: 0;
    }

    :global(.validation-icon.ok) {
        color: var(--color-success, #22c55e);
        flex-shrink: 0;
    }

    .validation-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1.25rem;
        border-top: 1px solid var(--color-border);
    }

    .validation-summary {
        font-size: 0.6875rem;
        color: var(--color-muted);
    }

    /* ── AI Assist Button ────────────────────────────────────────────── */
    .ai-assist-section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

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

    .ai-assist-btn:hover:not(:disabled) {
        filter: brightness(1.15);
    }

    .ai-assist-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .ai-assist-error {
        font-size: 0.6875rem;
        color: var(--color-error, #ef4444);
    }

    /* ── Condition Modal ─────────────────────────────────────────────── */
    .condition-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        max-width: 440px;
        width: 100%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
        display: flex;
        flex-direction: column;
    }

    .condition-modal-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.875rem 1.25rem;
        border-bottom: 1px solid var(--color-border);
    }

    :global(.condition-icon) {
        color: var(--color-warning, #f59e0b);
        flex-shrink: 0;
    }

    .condition-modal-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-foreground);
        flex: 1;
    }

    .condition-modal-body {
        padding: 1rem 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .condition-field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .condition-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .required {
        color: var(--color-accent);
    }

    .condition-helper {
        font-size: 0.6875rem;
        color: var(--color-muted);
    }

    .condition-input {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 0.375rem;
        color: var(--color-foreground);
        font-family: inherit;
        font-size: 0.8125rem;
        padding: 0.5rem 0.625rem;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .condition-input:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
    }

    .condition-input.invalid {
        border-color: var(--color-error, #ef4444);
    }

    .condition-input.invalid:focus {
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-error, #ef4444) 20%, transparent);
    }

    .condition-input.valid-input {
        border-color: var(--color-success, #22c55e);
    }

    .condition-error {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.6875rem;
        color: var(--color-error, #ef4444);
    }

    .condition-valid {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.6875rem;
        color: var(--color-success, #22c55e);
    }

    .condition-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem;
        border-top: 1px solid var(--color-border);
    }

    .confirm-btn.primary {
        background: var(--color-accent);
        color: white;
    }

    .confirm-btn.primary:hover:not(:disabled) {
        filter: brightness(1.1);
    }

    .confirm-btn.primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
