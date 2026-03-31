import { sendRequest } from '$lib/services/gateway.svelte';
import { conn } from '$lib/state/gateway';
import { toastSuccess, toastError } from '$lib/state/ui/toast.svelte';
import type { ToolStatusEntry, ToolsStatusReport } from '$lib/types/tools';
import { validateSkill, type ValidationFinding } from '$lib/utils/skill-validation';
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

export interface StagedChapter {
  tempId: string;
  type: string;
  name: string;
  description: string;
  guide: string;
  context: string;
  outputDef: string;
  conditionText?: string;
  toolIds: string[];
  positionX: number;
  positionY: number;
}

export interface StagedEdge {
  fromTempId: string;
  toTempId: string;
  label: string | null;
}

export interface StagedProposal {
  chapters: StagedChapter[];
  edges: StagedEdge[];
}

export interface DryRunChapterResult {
  chapterId: string;
  chapterName: string;
  output: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  error?: string;
}

export interface DryRunAnalysisDimension {
  name: string;
  score: number;
  verdict: 'pass' | 'warn' | 'fail';
  details: string;
}

export interface DryRunAnalysis {
  overallScore: number;
  dimensions: DryRunAnalysisDimension[];
  recommendations: string[];
}

export interface DryRunState {
  running: boolean;
  prompt: string;
  results: DryRunChapterResult[];
  totalDurationMs: number;
  totalTokens: number;
  analysis: DryRunAnalysis | null;
  analyzing: boolean;
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
  stagedProposal: null as StagedProposal | null,
  suggestedToolMap: {} as Record<string, string[]>,

  // Ghost suggestions (AI-02)
  ghostSuggestions: [] as Array<{ name: string; description: string }>,
  ghostLoading: false,
  ghostDismissed: false,

  // Dry run state
  dryRun: null as DryRunState | null,

  // Publish state
  publishing: false,

  // Modal/editing state (kept in module for Phase 7/8 access)
  editingChapter: null as ChapterEntry | null,
  editingChapterToolIds: [] as string[],
  editingCondition: null as ChapterEntry | null,
  conditionText: '',
  conditionName: '',
  chapterToDelete: null as ChapterEntry | null,
  showValidation: false,
  publishAnyway: false,
});

// ── Private timer (NOT $state — timers do not need reactivity) ───────

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _ghostTimer: ReturnType<typeof setTimeout> | null = null;

// ── Derived values (module-private, exposed via exported getters) ─────

const _poolToolIds = $derived([...new Set(Object.values(skillEditorState.chapterToolMap).flat())]);
const _allToolIds = $derived(skillEditorState.gatewayTools.map(t => t.id));

const _validationFindings = $derived.by(() => {
  return validateSkill({
    name: skillEditorState.name,
    description: skillEditorState.description,
    chapters: skillEditorState.chapters,
    edges: skillEditorState.chapterEdges.map(e => ({
      sourceChapterId: e.sourceChapterId,
      targetChapterId: e.targetChapterId,
    })),
    chapterToolMap: skillEditorState.chapterToolMap,
  });
});

const _validationCounts = $derived({
  errors: _validationFindings.filter(f => f.level === 'error').length,
  warnings: _validationFindings.filter(f => f.level === 'warning').length,
});

const _worstLevel = $derived<'error' | 'warning' | 'ok'>(
  _validationCounts.errors > 0 ? 'error' : _validationCounts.warnings > 0 ? 'warning' : 'ok'
);

const _conditionValidation = $derived(validateConditionText(skillEditorState.conditionText));

const _validationTooltip = $derived(
  [
    _validationCounts.errors > 0 ? `${_validationCounts.errors} error${_validationCounts.errors !== 1 ? 's' : ''}` : '',
    _validationCounts.warnings > 0 ? `${_validationCounts.warnings} warning${_validationCounts.warnings !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ') || 'All checks passing'
);

// Exported reactive getters — use these in components
export const skillEditorDerived = {
  get poolToolIds() { return _poolToolIds; },
  get allToolIds() { return _allToolIds; },
  get validationFindings() { return _validationFindings; },
  get validationCounts() { return _validationCounts; },
  get worstLevel() { return _worstLevel; },
  get conditionValidation() { return _conditionValidation; },
  get validationTooltip() { return _validationTooltip; },
};

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

  // Re-check: if still dirty, save failed — abort publish
  if (skillEditorState.dirty) {
    toastError('Publish failed', 'Cannot publish — unsaved changes could not be saved. Please try again.', { duration: 5000 });
    return;
  }

  skillEditorState.publishing = true;
  try {
    const res = await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish' }),
    });
    if (!res.ok) {
      const data = await res.json();
      if (data.errors?.length) {
        toastError('Publish failed', `Validation failed: ${data.errors.join('; ')}`, { duration: 5000 });
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    skillEditorState.status = 'published';
    skillEditorState.publishAnyway = false;
    toastSuccess('Skill published!');
    posthog.capture('skill_published', { skill_id: skillEditorState.skillId, skill_name: skillEditorState.name });
  } catch (e) {
    toastError('Publish failed', e instanceof Error ? e.message : 'Could not reach server. Please try again.', { duration: 5000 });
    console.error('[skill-editor] Publish failed:', e);
  } finally {
    skillEditorState.publishing = false;
  }
}

export function handlePublishClick() {
  if (skillEditorDerived.validationCounts.errors > 0) return; // button is disabled, shouldn't be reachable
  if (skillEditorDerived.validationCounts.warnings > 0) {
    skillEditorState.showValidation = true;
    skillEditorState.publishAnyway = true;
    return; // don't publish yet — show warnings in panel
  }
  publishSkill();
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
        availableToolIds: _allToolIds,
        ...(skillEditorState.chapters.length > 0 ? {
          currentGraph: {
            chapters: skillEditorState.chapters.map(c => ({ name: c.name, description: c.description })),
            edges: skillEditorState.chapterEdges.map(e => ({ sourceChapterId: e.sourceChapterId, targetChapterId: e.targetChapterId })),
          },
        } : {}),
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

    // Stage the proposal instead of committing immediately (AI-03)
    const stagedChapters: StagedChapter[] = data.chapters.map((ch: Record<string, unknown>, i: number) => ({
      tempId: `staged-${i}-${Date.now()}`,
      type: (ch.type as string) ?? 'chapter',
      name: ch.name as string,
      description: (ch.description as string) ?? '',
      guide: (ch.guide as string) ?? '',
      context: (ch.context as string) ?? '',
      outputDef: (ch.outputDef as string) ?? '',
      conditionText: (ch.conditionText as string) ?? '',
      toolIds: ((ch.toolIds as string[]) ?? []).filter((t: string) => _allToolIds.includes(t)),
      positionX: (ch.positionX as number) ?? 300,
      positionY: (ch.positionY as number) ?? (i * 180),
    }));

    const stagedEdges: StagedEdge[] = (data.edges ?? [])
      .filter((e: { from: number; to: number }) => e.from >= 0 && e.to >= 0 && e.from < stagedChapters.length && e.to < stagedChapters.length)
      .map((e: { from: number; to: number; label?: string | null }) => ({
        fromTempId: stagedChapters[e.from].tempId,
        toTempId: stagedChapters[e.to].tempId,
        label: e.label ?? null,
      }));

    skillEditorState.stagedProposal = { chapters: stagedChapters, edges: stagedEdges };
  } catch (e) {
    skillEditorState.aiBuildError = e instanceof Error ? e.message : 'Failed to build skill';
    console.error('[skill-editor] AI build failed:', e);
  } finally {
    skillEditorState.aiBuilding = false;
  }
}

// ── Dry run ───────────────────────────────────────────────────────────

/** Topological sort of chapters using edges. Returns ordered chapter IDs. */
function topoSort(chapters: ChapterEntry[], edges: typeof skillEditorState.chapterEdges): string[] {
  const ids = new Set(chapters.map(c => c.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of ids) { inDegree.set(id, 0); adj.set(id, []); }
  for (const e of edges) {
    if (!ids.has(e.sourceChapterId) || !ids.has(e.targetChapterId)) continue;
    adj.get(e.sourceChapterId)!.push(e.targetChapterId);
    inDegree.set(e.targetChapterId, (inDegree.get(e.targetChapterId) ?? 0) + 1);
  }
  const queue = [...ids].filter(id => (inDegree.get(id) ?? 0) === 0);
  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const next of adj.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  return sorted;
}

export async function startDryRun(prompt: string) {
  if (!prompt.trim() || skillEditorState.chapters.length === 0) return;

  const chapters = skillEditorState.chapters.filter(c => c.type !== 'condition');
  const order = topoSort(chapters, skillEditorState.chapterEdges);

  const results: DryRunChapterResult[] = order.map(id => {
    const ch = chapters.find(c => c.id === id);
    return {
      chapterId: id,
      chapterName: ch?.name ?? id,
      output: '',
      durationMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      status: 'pending' as const,
    };
  });

  skillEditorState.dryRun = {
    running: true,
    prompt,
    results,
    totalDurationMs: 0,
    totalTokens: 0,
    analysis: null,
    analyzing: false,
  };

  const upstreamOutputs: Array<{ chapterName: string; output: string }> = [];

  for (const result of skillEditorState.dryRun.results) {
    result.status = 'running';
    // Force reactivity update
    skillEditorState.dryRun = { ...skillEditorState.dryRun };

    const ch = chapters.find(c => c.id === result.chapterId);
    if (!ch) { result.status = 'skipped'; continue; }

    try {
      const res = await fetch('/api/builder/ai/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterName: ch.name,
          guide: ch.guide,
          context: ch.context,
          outputDef: ch.outputDef,
          toolIds: skillEditorState.chapterToolMap[ch.id] ?? [],
          userPrompt: prompt,
          upstreamOutputs,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        result.status = 'error';
        result.error = errData.error ?? `Request failed (${res.status})`;
      } else {
        const data = await res.json();
        result.output = data.output ?? '';
        result.durationMs = data.durationMs ?? 0;
        result.promptTokens = data.usage?.promptTokens ?? 0;
        result.completionTokens = data.usage?.completionTokens ?? 0;
        result.status = 'done';
        upstreamOutputs.push({ chapterName: ch.name, output: result.output });
      }
    } catch (e) {
      result.status = 'error';
      result.error = e instanceof Error ? e.message : 'Request failed';
    }

    // Update totals
    skillEditorState.dryRun.totalDurationMs += result.durationMs;
    skillEditorState.dryRun.totalTokens += result.promptTokens + result.completionTokens;
    // Force reactivity
    skillEditorState.dryRun = { ...skillEditorState.dryRun };
  }

  skillEditorState.dryRun.running = false;
  skillEditorState.dryRun = { ...skillEditorState.dryRun };

  // Auto-trigger analysis after all chapters complete
  const completedResults = skillEditorState.dryRun.results.filter(r => r.status === 'done');
  if (completedResults.length > 0) {
    analyzeRun();
  }
}

async function analyzeRun() {
  if (!skillEditorState.dryRun) return;
  skillEditorState.dryRun.analyzing = true;
  skillEditorState.dryRun = { ...skillEditorState.dryRun };

  const chapters = skillEditorState.chapters
    .filter(c => c.type !== 'condition')
    .map(ch => ({
      name: ch.name,
      guide: ch.guide,
      outputDef: ch.outputDef,
      context: ch.context,
      toolIds: skillEditorState.chapterToolMap[ch.id] ?? [],
    }));

  try {
    const res = await fetch('/api/builder/ai/analyze-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillName: skillEditorState.name,
        skillDescription: skillEditorState.description,
        chapters,
        results: skillEditorState.dryRun.results.map(r => ({
          output: r.output,
          status: r.status,
          durationMs: r.durationMs,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
        })),
        totalTokens: skillEditorState.dryRun.totalTokens,
        totalDurationMs: skillEditorState.dryRun.totalDurationMs,
      }),
    });

    if (res.ok) {
      const analysis = await res.json();
      if (skillEditorState.dryRun) {
        skillEditorState.dryRun.analysis = analysis;
      }
    }
  } catch (e) {
    console.error('[skill-editor] Run analysis failed:', e);
  } finally {
    if (skillEditorState.dryRun) {
      skillEditorState.dryRun.analyzing = false;
      skillEditorState.dryRun = { ...skillEditorState.dryRun };
    }
  }
}

export function clearDryRun() {
  skillEditorState.dryRun = null;
}

// ── Ghost suggestions (AI-02) ─────────────────────────────────────────

export function fetchGhostSuggestions() {
  if (_ghostTimer) clearTimeout(_ghostTimer);

  const desc = skillEditorState.description.trim();
  if (desc.length < 10 || skillEditorState.ghostDismissed || skillEditorState.chapters.length > 0 || skillEditorState.aiBuilding) {
    skillEditorState.ghostSuggestions = [];
    return;
  }

  _ghostTimer = setTimeout(async () => {
    skillEditorState.ghostLoading = true;
    try {
      const res = await fetch('/api/builder/ai/suggest-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skillEditorState.name.trim(),
          description: desc,
          availableToolIds: _allToolIds,
          previewOnly: true,
        }),
      });
      if (!res.ok) { skillEditorState.ghostSuggestions = []; return; }
      const data = await res.json();
      if (skillEditorState.description.trim() === desc) {
        skillEditorState.ghostSuggestions = (data.chapters ?? []).slice(0, 3);
      }
    } catch {
      skillEditorState.ghostSuggestions = [];
    } finally {
      skillEditorState.ghostLoading = false;
    }
  }, 500);
}

export function dismissGhostSuggestions() {
  skillEditorState.ghostDismissed = true;
  skillEditorState.ghostSuggestions = [];
  if (_ghostTimer) { clearTimeout(_ghostTimer); _ghostTimer = null; }
}

export async function generateGhostChapter(chapterName: string) {
  dismissGhostSuggestions();
  skillEditorState.aiBuilding = true;
  skillEditorState.aiBuildError = null;

  try {
    const res = await fetch('/api/builder/ai/suggest-chapter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: chapterName,
        description: '',
        skillName: skillEditorState.name.trim(),
        skillDescription: skillEditorState.description.trim(),
        availableToolIds: _allToolIds,
      }),
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const createRes = await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add-chapter',
        name: data.name || chapterName,
        type: 'chapter',
        positionX: 300,
        positionY: skillEditorState.chapters.length * 180,
      }),
    });
    if (!createRes.ok) throw new Error('Failed to create chapter');
    const { id } = await createRes.json();

    await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update-chapter',
        chapterId: id,
        data: { description: data.description ?? '', guide: data.guide ?? '', context: data.context ?? '', outputDef: data.outputDef ?? '' },
      }),
    });

    const toolIds = (data.suggestedToolIds ?? []).filter((t: string) => _allToolIds.includes(t));
    if (toolIds.length > 0) {
      await fetch(`/api/builder/skills/${skillEditorState.skillId}/chapter-tools/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolIds }),
      });
    }

    skillEditorState.chapters = [...skillEditorState.chapters, {
      id, type: 'chapter', name: data.name || chapterName, description: data.description ?? '',
      guide: data.guide ?? '', context: data.context ?? '', outputDef: data.outputDef ?? '',
      positionX: 300, positionY: (skillEditorState.chapters.length - 1) * 180,
    }];
    skillEditorState.chapterToolMap = { ...skillEditorState.chapterToolMap, [id]: toolIds };
  } catch (e) {
    skillEditorState.aiBuildError = e instanceof Error ? e.message : 'Failed to generate chapter';
  } finally {
    skillEditorState.aiBuilding = false;
  }
}

// ── Staged proposal accept/reject (AI-03) ────────────────────────────

const _tempToRealId = new Map<string, string>();

async function commitStagedChapter(ch: StagedChapter): Promise<string | null> {
  try {
    const createRes = await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add-chapter',
        name: ch.name,
        type: ch.type,
        conditionText: ch.conditionText ?? '',
        positionX: ch.positionX,
        positionY: ch.positionY,
      }),
    });
    if (!createRes.ok) return null;
    const { id } = await createRes.json();

    // Save metadata
    await fetch(`/api/builder/skills/${skillEditorState.skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update-chapter',
        chapterId: id,
        data: { description: ch.description, guide: ch.guide, context: ch.context, outputDef: ch.outputDef, conditionText: ch.conditionText ?? '' },
      }),
    });

    // Save tools
    if (ch.toolIds.length > 0) {
      await fetch(`/api/builder/skills/${skillEditorState.skillId}/chapter-tools/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolIds: ch.toolIds }),
      });
    }

    // Update local state
    skillEditorState.chapters = [...skillEditorState.chapters, {
      id, type: ch.type, name: ch.name, description: ch.description, guide: ch.guide,
      context: ch.context, outputDef: ch.outputDef, conditionText: ch.conditionText,
      positionX: ch.positionX, positionY: ch.positionY,
    }];
    skillEditorState.chapterToolMap = { ...skillEditorState.chapterToolMap, [id]: ch.toolIds };
    if (ch.toolIds.length > 0) {
      skillEditorState.suggestedToolMap = { ...skillEditorState.suggestedToolMap, [id]: ch.toolIds };
    }
    _tempToRealId.set(ch.tempId, id);
    return id;
  } catch { return null; }
}

export async function acceptProposedChapter(tempId: string) {
  const proposal = skillEditorState.stagedProposal;
  if (!proposal) return;
  const ch = proposal.chapters.find(c => c.tempId === tempId);
  if (!ch) return;

  const realId = await commitStagedChapter(ch);
  if (!realId) return;

  // Create edges where both ends are accepted
  for (const edge of proposal.edges) {
    const srcReal = edge.fromTempId === tempId ? realId : _tempToRealId.get(edge.fromTempId);
    const tgtReal = edge.toTempId === tempId ? realId : _tempToRealId.get(edge.toTempId);
    if (srcReal && tgtReal) {
      await connectChapters(srcReal, tgtReal, edge.label ?? undefined);
    }
  }

  // Remove from staged
  const remaining = proposal.chapters.filter(c => c.tempId !== tempId);
  skillEditorState.stagedProposal = remaining.length > 0
    ? { chapters: remaining, edges: proposal.edges.filter(e => e.fromTempId !== tempId && e.toTempId !== tempId) }
    : null;
}

export async function rejectProposedChapter(tempId: string) {
  const proposal = skillEditorState.stagedProposal;
  if (!proposal) return;
  const remaining = proposal.chapters.filter(c => c.tempId !== tempId);
  skillEditorState.stagedProposal = remaining.length > 0
    ? { chapters: remaining, edges: proposal.edges.filter(e => e.fromTempId !== tempId && e.toTempId !== tempId) }
    : null;
}

export async function acceptAllProposed() {
  const proposal = skillEditorState.stagedProposal;
  if (!proposal) return;

  for (const ch of proposal.chapters) {
    await commitStagedChapter(ch);
  }

  // Create all edges after all chapters are committed
  for (const edge of proposal.edges) {
    const srcReal = _tempToRealId.get(edge.fromTempId);
    const tgtReal = _tempToRealId.get(edge.toTempId);
    if (srcReal && tgtReal) {
      await connectChapters(srcReal, tgtReal, edge.label ?? undefined);
    }
  }

  skillEditorState.stagedProposal = null;
  posthog.capture('skill_ai_generated', {
    skill_id: skillEditorState.skillId,
    skill_name: skillEditorState.name,
    chapters_count: proposal.chapters.length,
  });
}

export function rejectAllProposed() {
  skillEditorState.stagedProposal = null;
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
  if (!_conditionValidation.valid) return;
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
  if (!skillEditorState.editingCondition || !skillEditorState.editingCondition.id || !_conditionValidation.valid) return;
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
  dismissGhostSuggestions();
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
  skillEditorState.publishAnyway = false;
  skillEditorState.aiBuildError = null;
  skillEditorState.stagedProposal = null;
  skillEditorState.suggestedToolMap = {};
  skillEditorState.ghostSuggestions = [];
  skillEditorState.ghostLoading = false;
  skillEditorState.ghostDismissed = false;
  skillEditorState.dryRun = null;
  if (_ghostTimer) { clearTimeout(_ghostTimer); _ghostTimer = null; }
}
