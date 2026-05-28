// Staged AI proposal accept/reject (AI-03), split from skill-editor.svelte.ts.
// Depends one-directionally on the core module (`skillEditorState`, `connectChapters`).

import posthog from 'posthog-js';
import { skillEditorState, connectChapters } from './skill-editor.core.svelte';
import type { StagedChapter } from './skill-editor.types';

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
        data: {
          description: ch.description,
          guide: ch.guide,
          context: ch.context,
          outputDef: ch.outputDef,
          conditionText: ch.conditionText ?? '',
        },
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
    skillEditorState.chapters = [
      ...skillEditorState.chapters,
      {
        id,
        type: ch.type,
        name: ch.name,
        description: ch.description,
        guide: ch.guide,
        context: ch.context,
        outputDef: ch.outputDef,
        conditionText: ch.conditionText,
        positionX: ch.positionX,
        positionY: ch.positionY,
      },
    ];
    skillEditorState.chapterToolMap = { ...skillEditorState.chapterToolMap, [id]: ch.toolIds };
    if (ch.toolIds.length > 0) {
      skillEditorState.suggestedToolMap = {
        ...skillEditorState.suggestedToolMap,
        [id]: ch.toolIds,
      };
    }
    _tempToRealId.set(ch.tempId, id);
    return id;
  } catch {
    return null;
  }
}

export async function acceptProposedChapter(tempId: string) {
  const proposal = skillEditorState.stagedProposal;
  if (!proposal) return;
  const ch = proposal.chapters.find((c) => c.tempId === tempId);
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
  const remaining = proposal.chapters.filter((c) => c.tempId !== tempId);
  skillEditorState.stagedProposal =
    remaining.length > 0
      ? {
          chapters: remaining,
          edges: proposal.edges.filter((e) => e.fromTempId !== tempId && e.toTempId !== tempId),
        }
      : null;
}

export async function rejectProposedChapter(tempId: string) {
  const proposal = skillEditorState.stagedProposal;
  if (!proposal) return;
  const remaining = proposal.chapters.filter((c) => c.tempId !== tempId);
  skillEditorState.stagedProposal =
    remaining.length > 0
      ? {
          chapters: remaining,
          edges: proposal.edges.filter((e) => e.fromTempId !== tempId && e.toTempId !== tempId),
        }
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
