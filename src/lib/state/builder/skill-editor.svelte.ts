import { sendRequest } from '$lib/services/gateway.svelte';
import { conn } from '$lib/state/gateway';
import type { ToolStatusEntry, ToolsStatusReport } from '$lib/types/tools';
import posthog from 'posthog-js';

// ── Types ────────────────────────────────────────────────────────────

export interface ChapterEntry {
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

export interface ValidationFinding {
  level: 'error' | 'warning' | 'ok';
  message: string;
}

// ── State ────────────────────────────────────────────────────────────

export const skillEditorState = $state({
  // Core skill fields
  skillId: '',
  name: 'Untitled Skill',
  description: '',
  emoji: '📘',
  status: 'draft' as 'draft' | 'published',
  maxCycles: 3,

  // Load/save state
  loading: true,
  saving: false,
  dirty: false,

  // Data
  chapters: [] as ChapterEntry[],
  chapterEdges: [] as { id: string; sourceChapterId: string; targetChapterId: string; label: string | null }[],
  chapterToolMap: {} as Record<string, string[]>,
  gatewayTools: [] as ToolStatusEntry[],

  // AI state
  aiBuilding: false,
  aiBuildError: null as string | null,

  // Publish state
  publishing: false,
  publishError: null as string | null,

  // Modal/editing state (kept in module for Phase 7/8 access)
  editingChapter: null as ChapterEntry | null,
  editingChapterToolIds: [] as string[],
  editingCondition: null as ChapterEntry | null,
  conditionText: '',
  conditionName: '',
  chapterToDelete: null as ChapterEntry | null,
  showValidation: false,
});

// ── Private timer (NOT $state — timers do not need reactivity) ───────

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

// ── Derived values ────────────────────────────────────────────────────

export const poolToolIds = $derived([...new Set(Object.values(skillEditorState.chapterToolMap).flat())]);
export const allToolIds = $derived(skillEditorState.gatewayTools.map(t => t.id));

export const validationFindings = $derived.by(() => {
  const findings: ValidationFinding[] = [];

  // Check skill has a name
  if (!skillEditorState.name.trim() || skillEditorState.name.trim() === 'Untitled Skill') {
    findings.push({ level: 'warning', message: 'Skill has no custom name' });
  } else {
    findings.push({ level: 'ok', message: 'Skill has a name' });
  }

  // Check skill has a description
  if (!skillEditorState.description.trim()) {
    findings.push({ level: 'warning', message: 'Skill has no description' });
  } else {
    findings.push({ level: 'ok', message: 'Skill has a description' });
  }

  // Check at least one chapter exists
  if (skillEditorState.chapters.length === 0) {
    findings.push({ level: 'error', message: 'No chapters defined' });
  } else {
    findings.push({ level: 'ok', message: `${skillEditorState.chapters.length} chapter${skillEditorState.chapters.length !== 1 ? 's' : ''} defined` });
  }

  // Check chapters have tools assigned
  const chaptersWithoutTools = skillEditorState.chapters.filter(ch => !(skillEditorState.chapterToolMap[ch.id]?.length));
  if (chaptersWithoutTools.length > 0) {
    findings.push({ level: 'warning', message: `${chaptersWithoutTools.length} chapter${chaptersWithoutTools.length !== 1 ? 's' : ''} without tools` });
  } else if (skillEditorState.chapters.length > 0) {
    findings.push({ level: 'ok', message: 'All chapters have tools' });
  }

  // Check chapters have guide text
  const chaptersWithoutGuide = skillEditorState.chapters.filter(ch => !ch.guide?.trim());
  if (chaptersWithoutGuide.length > 0) {
    findings.push({ level: 'warning', message: `${chaptersWithoutGuide.length} chapter${chaptersWithoutGuide.length !== 1 ? 's' : ''} without instructions` });
  } else if (skillEditorState.chapters.length > 0) {
    findings.push({ level: 'ok', message: 'All chapters have instructions' });
  }

  // Check chapters have output definitions
  const chaptersWithoutOutput = skillEditorState.chapters.filter(ch => !ch.outputDef?.trim());
  if (chaptersWithoutOutput.length > 0) {
    findings.push({ level: 'warning', message: `${chaptersWithoutOutput.length} chapter${chaptersWithoutOutput.length !== 1 ? 's' : ''} without output definitions` });
  } else if (skillEditorState.chapters.length > 0) {
    findings.push({ level: 'ok', message: 'All chapters have output definitions' });
  }

  // Check DAG is connected (has edges if >1 chapter)
  if (skillEditorState.chapters.length > 1 && skillEditorState.chapterEdges.length === 0) {
    findings.push({ level: 'warning', message: 'Chapters are not connected (no edges)' });
  } else if (skillEditorState.chapters.length > 1) {
    findings.push({ level: 'ok', message: 'Chapter flow is connected' });
  }

  // Check for cycles in the DAG
  if (skillEditorState.chapters.length > 1 && skillEditorState.chapterEdges.length > 0) {
    const adj = new Map<string, string[]>();
    for (const ch of skillEditorState.chapters) adj.set(ch.id, []);
    for (const e of skillEditorState.chapterEdges) adj.get(e.sourceChapterId)?.push(e.targetChapterId);
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
    for (const ch of skillEditorState.chapters) {
      if (!visited.has(ch.id)) dfs(ch.id);
    }
    if (hasCycle) {
      findings.push({ level: 'ok', message: `Cycle detected — max ${skillEditorState.maxCycles} iteration${skillEditorState.maxCycles !== 1 ? 's' : ''}` });
    } else {
      findings.push({ level: 'ok', message: 'Chapter graph is acyclic' });
    }
  }

  return findings;
});

export const validationCounts = $derived({
  errors: validationFindings.filter(f => f.level === 'error').length,
  warnings: validationFindings.filter(f => f.level === 'warning').length,
  ok: validationFindings.filter(f => f.level === 'ok').length,
});

export const worstLevel = $derived<'error' | 'warning' | 'ok'>(
  validationCounts.errors > 0 ? 'error' : validationCounts.warnings > 0 ? 'warning' : 'ok'
);

export const conditionValidation = $derived(validateConditionText(skillEditorState.conditionText));

export const validationTooltip = $derived(
  [
    validationCounts.errors > 0 ? `${validationCounts.errors} error${validationCounts.errors !== 1 ? 's' : ''}` : '',
    validationCounts.warnings > 0 ? `${validationCounts.warnings} warning${validationCounts.warnings !== 1 ? 's' : ''}` : '',
    validationCounts.ok > 0 ? `${validationCounts.ok} ok` : '',
  ].filter(Boolean).join(', ')
);

// ── Pure functions ────────────────────────────────────────────────────

export function validateConditionText(text: string): { valid: boolean; reason?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { valid: false, reason: 'Condition text is required' };
  if (!trimmed.endsWith('?')) return { valid: false, reason: 'Must be a question (end with ?)' };

  const subjective = /\b(feel|feeling|think|opinion|subjective|how much|how well|how good|how bad|prefer|like|enjoy|rate|score|scale|how does|how do)\b/i;
  if (subjective.test(trimmed)) return { valid: false, reason: 'Must have a binary yes/no answer — not subjective' };

  const binary = /^(is|are|does|do|has|have|can|could|will|would|should|shall|was|were|did|had)\b/i;
  if (!binary.test(trimmed)) return { valid: false, reason: 'Start with a binary question word (Is, Does, Has, Can, Will, etc.)' };

  return { valid: true };
}

// ── Business functions ────────────────────────────────────────────────

export async function loadGatewayTools() {
  if (!conn.connected) return;
  try {
    const report = (await sendRequest('tools.status', {})) as ToolsStatusReport;
    skillEditorState.gatewayTools = report.tools;
  } catch (e) {
    console.error('[skill-editor] Failed to load gateway tools:', e);
  }
}

export async function loadSkill(skillId: string) {
  skillEditorState.skillId = skillId;
  skillEditorState.loading = true;
  try {
    const res = await fetch(`/api/builder/skills/${skillId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    skillEditorState.name = data.skill.name;
    skillEditorState.description = data.skill.description ?? '';
    skillEditorState.emoji = data.skill.emoji ?? '📘';
    skillEditorState.status = data.skill.status;
    skillEditorState.maxCycles = data.skill.maxCycles ?? 3;
    skillEditorState.chapters = data.chapters;
    skillEditorState.chapterEdges = data.edges;

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
    skillEditorState.chapterToolMap = toolMap;
  } catch (e) {
    console.error('[skill-editor] Failed to load:', e);
  } finally {
    skillEditorState.loading = false;
  }
}

export function scheduleSave() {
  skillEditorState.dirty = true;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveSkill(), 2000);
}

export async function saveSkill() {
  skillEditorState.saving = true;
  try {
    await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: skillEditorState.name,
        description: skillEditorState.description,
        emoji: skillEditorState.emoji,
        maxCycles: skillEditorState.maxCycles,
      }),
    });
    skillEditorState.dirty = false;
  } catch (e) {
    console.error('[skill-editor] Save failed:', e);
  } finally {
    skillEditorState.saving = false;
  }
}

export async function publishSkill() {
  // Flush any pending save first
  if (skillEditorState.dirty) await saveSkill();
  skillEditorState.publishing = true;
  skillEditorState.publishError = null;
  try {
    const res = await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish' }),
    });
    if (!res.ok) {
      const data = await res.json();
      if (data.errors?.length) {
        skillEditorState.publishError = data.errors.join('; ');
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    skillEditorState.status = 'published';
    posthog.capture('skill_published', { skill_id: skillEditorState.skillId, skill_name: skillEditorState.name });
  } catch (e) {
    skillEditorState.publishError = e instanceof Error ? e.message : 'Publish failed';
    console.error('[skill-editor] Publish failed:', e);
  } finally {
    skillEditorState.publishing = false;
  }
}

export async function buildSkillWithAI() {
  if (!skillEditorState.description.trim()) return;
  skillEditorState.aiBuilding = true;
  skillEditorState.aiBuildError = null;

  try {
    const res = await fetch('/api/builder/ai/suggest-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: skillEditorState.name.trim(),
        description: skillEditorState.description.trim(),
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
    const newToolMap: Record<string, string[]> = { ...skillEditorState.chapterToolMap };

    for (const ch of data.chapters) {
      const createRes = await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
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
        await fetch(`/api/builder/skills/${skillEditorState.skillId}/chapter-tools/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolIds }),
        });
      }
      newToolMap[id] = toolIds;

      // Save chapter metadata (guide, context, outputDef)
      if (ch.guide || ch.context || ch.outputDef || ch.description) {
        await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
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
    const newEdges: typeof skillEditorState.chapterEdges = [];
    for (const edge of data.edges ?? []) {
      const srcId = chapterIdMap[edge.from];
      const tgtId = chapterIdMap[edge.to];
      if (!srcId || !tgtId) continue;

      const edgeRes = await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
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
    skillEditorState.chapters = [...skillEditorState.chapters, ...newChapters];
    skillEditorState.chapterEdges = [...skillEditorState.chapterEdges, ...newEdges];
    skillEditorState.chapterToolMap = newToolMap;
    posthog.capture('skill_ai_generated', {
      skill_id: skillEditorState.skillId,
      skill_name: skillEditorState.name,
      chapters_count: newChapters.length,
    });
  } catch (e) {
    skillEditorState.aiBuildError = e instanceof Error ? e.message : 'Failed to build skill';
    console.error('[skill-editor] AI build failed:', e);
  } finally {
    skillEditorState.aiBuilding = false;
  }
}

export async function addCondition() {
  try {
    skillEditorState.editingCondition = null;
    skillEditorState.conditionText = '';
    skillEditorState.conditionName = `Condition ${skillEditorState.chapters.filter(c => c.type === 'condition').length + 1}`;
    skillEditorState.editingCondition = {
      id: '',
      type: 'condition',
      name: skillEditorState.conditionName,
      description: '',
      guide: '',
      context: '',
      outputDef: '',
      conditionText: '',
      positionX: 300,
      positionY: 100 + skillEditorState.chapters.length * 180,
    };
  } catch (e) {
    console.error('[skill-editor] addCondition failed:', e);
  }
}

export async function saveCondition() {
  if (!conditionValidation.valid) return;
  try {
    const res = await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add-chapter',
        name: skillEditorState.conditionName || 'Condition',
        type: 'condition',
        conditionText: skillEditorState.conditionText,
        positionX: 300,
        positionY: 100 + skillEditorState.chapters.length * 180,
      }),
    });

    if (res.ok) {
      const { id } = await res.json();
      skillEditorState.chapters = [...skillEditorState.chapters, {
        id,
        type: 'condition',
        name: skillEditorState.conditionName || 'Condition',
        description: '',
        guide: '',
        context: '',
        outputDef: '',
        conditionText: skillEditorState.conditionText,
        positionX: 300,
        positionY: 100 + (skillEditorState.chapters.length - 1) * 180,
      }];
      skillEditorState.chapterToolMap = { ...skillEditorState.chapterToolMap, [id]: [] };
    }
    skillEditorState.editingCondition = null;
  } catch (e) {
    console.error('[skill-editor] saveCondition failed:', e);
  }
}

export function openConditionOrChapter(chapter: ChapterEntry) {
  if (chapter.type === 'condition') {
    skillEditorState.editingCondition = chapter;
    skillEditorState.conditionText = chapter.conditionText ?? '';
    skillEditorState.conditionName = chapter.name;
  } else {
    openChapterEditor(chapter);
  }
}

export async function updateCondition() {
  if (!skillEditorState.editingCondition || !skillEditorState.editingCondition.id || !conditionValidation.valid) return;
  try {
    await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update-chapter',
        chapterId: skillEditorState.editingCondition.id,
        data: { name: skillEditorState.conditionName, conditionText: skillEditorState.conditionText },
      }),
    });

    skillEditorState.chapters = skillEditorState.chapters.map(c =>
      c.id === skillEditorState.editingCondition!.id
        ? { ...c, name: skillEditorState.conditionName, conditionText: skillEditorState.conditionText }
        : c
    );
    skillEditorState.editingCondition = null;
  } catch (e) {
    console.error('[skill-editor] updateCondition failed:', e);
  }
}

export async function addChapter() {
  try {
    const chapterName = `Chapter ${skillEditorState.chapters.length + 1}`;
    const res = await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add-chapter',
        name: chapterName,
        positionX: 100 + skillEditorState.chapters.length * 200,
        positionY: 100,
      }),
    });
    if (res.ok) {
      const { id } = await res.json();
      skillEditorState.chapters = [...skillEditorState.chapters, {
        id,
        name: chapterName,
        description: '',
        guide: '',
        context: '',
        outputDef: '',
        positionX: 100 + (skillEditorState.chapters.length - 1) * 200,
        positionY: 100,
      }];
      skillEditorState.chapterToolMap = { ...skillEditorState.chapterToolMap, [id]: [] };
    }
  } catch (e) {
    console.error('[skill-editor] addChapter failed:', e);
  }
}

export async function removeChapter(chapterId: string) {
  try {
    await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-chapter', chapterId }),
    });
    skillEditorState.chapters = skillEditorState.chapters.filter(c => c.id !== chapterId);
    skillEditorState.chapterEdges = skillEditorState.chapterEdges.filter(
      e => e.sourceChapterId !== chapterId && e.targetChapterId !== chapterId
    );
    const { [chapterId]: _, ...restToolMap } = skillEditorState.chapterToolMap;
    skillEditorState.chapterToolMap = restToolMap;
  } catch (e) {
    console.error('[skill-editor] removeChapter failed:', e);
  }
}

export async function updateChapterPosition(chapterId: string, x: number, y: number) {
  try {
    skillEditorState.chapters = skillEditorState.chapters.map(c =>
      c.id === chapterId ? { ...c, positionX: x, positionY: y } : c
    );
    await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update-chapter', chapterId, data: { positionX: x, positionY: y } }),
    });
  } catch (e) {
    console.error('[skill-editor] updateChapterPosition failed:', e);
  }
}

export async function connectChapters(sourceId: string, targetId: string, label?: string) {
  try {
    const res = await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add-edge',
        sourceChapterId: sourceId,
        targetChapterId: targetId,
        label: label ?? null,
      }),
    });
    if (res.ok) {
      const { id } = await res.json();
      skillEditorState.chapterEdges = [...skillEditorState.chapterEdges, {
        id,
        sourceChapterId: sourceId,
        targetChapterId: targetId,
        label: label ?? null,
      }];
    }
  } catch (e) {
    console.error('[skill-editor] connectChapters failed:', e);
  }
}

export async function deleteEdge(edgeId: string) {
  try {
    await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-edge', edgeId }),
    });
    skillEditorState.chapterEdges = skillEditorState.chapterEdges.filter(e => e.id !== edgeId);
  } catch (e) {
    console.error('[skill-editor] deleteEdge failed:', e);
  }
}

export function confirmRemoveChapter(chapter: ChapterEntry) {
  skillEditorState.chapterToDelete = chapter;
}

export async function executeDeleteChapter() {
  if (!skillEditorState.chapterToDelete) return;
  await removeChapter(skillEditorState.chapterToDelete.id);
  skillEditorState.chapterToDelete = null;
}

export function openChapterEditor(chapter: ChapterEntry) {
  skillEditorState.editingChapter = chapter;
  skillEditorState.editingChapterToolIds = skillEditorState.chapterToolMap[chapter.id] ?? [];
}

export async function saveChapterEdits(data: {
  name: string;
  description: string;
  guide: string;
  context: string;
  outputDef: string;
  toolIds: string[];
}) {
  if (!skillEditorState.editingChapter) return;
  const chapterId = skillEditorState.editingChapter.id;

  skillEditorState.saving = true;
  try {
    // Save chapter metadata
    await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update-chapter',
        chapterId,
        data: {
          name: data.name,
          description: data.description,
          guide: data.guide,
          context: data.context,
          outputDef: data.outputDef,
        },
      }),
    });

    // Save chapter tools
    await fetch(`/api/builder/skills/${skillEditorState.skillId}/chapter-tools/${chapterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolIds: data.toolIds }),
    });

    // Update local state
    skillEditorState.chapters = skillEditorState.chapters.map(c =>
      c.id === chapterId
        ? { ...c, name: data.name, description: data.description, guide: data.guide, context: data.context, outputDef: data.outputDef }
        : c
    );
    skillEditorState.chapterToolMap = { ...skillEditorState.chapterToolMap, [chapterId]: data.toolIds };
  } catch (e) {
    console.error('[skill-editor] Save chapter failed:', e);
  } finally {
    skillEditorState.saving = false;
    skillEditorState.editingChapter = null;
  }
}

// ── Init / Cleanup ────────────────────────────────────────────────────

export function initSkillEditor(skillId: string) {
  skillEditorState.skillId = skillId;
  loadSkill(skillId);
  loadGatewayTools();
}

export function cleanupSkillEditor() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  // Reset state so stale data doesn't flash on next visit
  skillEditorState.loading = true;
  skillEditorState.dirty = false;
  skillEditorState.editingChapter = null;
  skillEditorState.editingCondition = null;
  skillEditorState.chapterToDelete = null;
  skillEditorState.showValidation = false;
  skillEditorState.publishError = null;
  skillEditorState.aiBuildError = null;
}
