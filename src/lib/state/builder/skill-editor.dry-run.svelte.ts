// Dry-run + suggested-test-prompt state for the skill editor (split from skill-editor.svelte.ts).
// Depends one-directionally on the core module (reads/writes `skillEditorState`).

import { skillEditorState } from './skill-editor.core.svelte';
import type { ChapterEntry, DryRunChapterResult, SuggestedPrompt } from './skill-editor.types';

/** Topological sort of chapters using edges. Returns ordered chapter IDs. */
function topoSort(chapters: ChapterEntry[], edges: typeof skillEditorState.chapterEdges): string[] {
  const ids = new Set(chapters.map((c) => c.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const e of edges) {
    if (!ids.has(e.sourceChapterId) || !ids.has(e.targetChapterId)) continue;
    adj.get(e.sourceChapterId)!.push(e.targetChapterId);
    inDegree.set(e.targetChapterId, (inDegree.get(e.targetChapterId) ?? 0) + 1);
  }
  const queue = [...ids].filter((id) => (inDegree.get(id) ?? 0) === 0);
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

// ── Suggested test prompts ─────────────────────────────────────────────

export const dryRunSuggestions = $state({
  prompts: [] as SuggestedPrompt[],
  loading: false,
});

export async function fetchTestPromptSuggestions() {
  const chapters = skillEditorState.chapters.filter((c) => c.type !== 'condition');
  if (chapters.length === 0 || !skillEditorState.description.trim()) {
    dryRunSuggestions.prompts = [];
    return;
  }

  dryRunSuggestions.loading = true;
  try {
    const res = await fetch('/api/builder/ai/suggest-prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillName: skillEditorState.name,
        skillDescription: skillEditorState.description,
        chapters: chapters.map((ch) => ({
          name: ch.name,
          description: ch.description,
          guide: ch.guide,
          context: ch.context,
          toolIds: skillEditorState.chapterToolMap[ch.id] ?? [],
        })),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      dryRunSuggestions.prompts = data.prompts ?? [];
    }
  } catch {
    dryRunSuggestions.prompts = [];
  } finally {
    dryRunSuggestions.loading = false;
  }
}

export async function startDryRun(prompt: string) {
  if (!prompt.trim() || skillEditorState.chapters.length === 0) return;

  const chapters = skillEditorState.chapters.filter((c) => c.type !== 'condition');
  const order = topoSort(chapters, skillEditorState.chapterEdges);

  const results: DryRunChapterResult[] = order.map((id) => {
    const ch = chapters.find((c) => c.id === id);
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

    const ch = chapters.find((c) => c.id === result.chapterId);
    if (!ch) {
      result.status = 'skipped';
      continue;
    }

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
  const completedResults = skillEditorState.dryRun.results.filter((r) => r.status === 'done');
  if (completedResults.length > 0) {
    analyzeRun();
  }
}

async function analyzeRun() {
  if (!skillEditorState.dryRun) return;
  skillEditorState.dryRun.analyzing = true;
  skillEditorState.dryRun = { ...skillEditorState.dryRun };

  const chapters = skillEditorState.chapters
    .filter((c) => c.type !== 'condition')
    .map((ch) => ({
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
        results: skillEditorState.dryRun.results.map((r) => ({
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
