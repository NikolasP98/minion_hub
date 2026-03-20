// Pure validation function for skills — no Svelte, DB, or external imports.
//
// Used by:
//   - skill-editor.svelte.ts ($derived validationFindings)
//   - builder.service.ts (server-side publish gate)

// ── Types ─────────────────────────────────────────────────────────────

export interface SkillValidationInput {
  name: string;
  description: string;
  chapters: Array<{
    id: string;
    name: string;
    type?: string;
    guide?: string;
    conditionText?: string;
    outputDef?: string;
  }>;
  edges: Array<{ sourceChapterId: string; targetChapterId: string }>;
  chapterToolMap: Record<string, string[]>;
}

export interface ValidationFinding {
  level: 'error' | 'warning';
  message: string;
  chapterId: string | null;
  chapterName: string | null;
}

// ── Implementation ────────────────────────────────────────────────────

export function validateSkill(input: SkillValidationInput): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  // ── Skill-level warnings ──────────────────────────────────────────

  if (!input.name.trim() || input.name.trim() === 'Untitled Skill') {
    findings.push({
      level: 'warning',
      message: 'Skill has no custom name',
      chapterId: null,
      chapterName: null,
    });
  }

  if (!input.description.trim()) {
    findings.push({
      level: 'warning',
      message: 'Skill has no description',
      chapterId: null,
      chapterName: null,
    });
  }

  // ── Early return: no chapters ──────────────────────────────────────

  if (input.chapters.length === 0) {
    findings.push({
      level: 'error',
      message: 'No chapters defined',
      chapterId: null,
      chapterName: null,
    });
    return findings;
  }

  // ── Per-chapter checks ─────────────────────────────────────────────

  for (const ch of input.chapters) {
    const isCondition = ch.type === 'condition';

    if (isCondition) {
      // Condition nodes: require conditionText
      if (!ch.conditionText?.trim()) {
        findings.push({
          level: 'error',
          message: 'Condition is missing its condition text',
          chapterId: ch.id,
          chapterName: ch.name,
        });
      }
    } else {
      // Chapter nodes: require guide text and at least one tool
      if (!ch.guide?.trim()) {
        findings.push({
          level: 'error',
          message: 'Chapter is missing instructions (guide)',
          chapterId: ch.id,
          chapterName: ch.name,
        });
      }

      if (!(input.chapterToolMap[ch.id]?.length)) {
        findings.push({
          level: 'error',
          message: 'Chapter has no tools assigned',
          chapterId: ch.id,
          chapterName: ch.name,
        });
      }

      // Chapters without output definitions (warning)
      if (!ch.outputDef?.trim()) {
        findings.push({
          level: 'warning',
          message: 'Chapter has no output definition',
          chapterId: ch.id,
          chapterName: ch.name,
        });
      }
    }
  }

  // ── Connectivity warnings ──────────────────────────────────────────

  if (input.chapters.length > 1 && input.edges.length === 0) {
    findings.push({
      level: 'warning',
      message: 'Chapters are not connected (no edges)',
      chapterId: null,
      chapterName: null,
    });
  }

  // ── Cycle detection (DFS) ──────────────────────────────────────────

  if (input.chapters.length > 1 && input.edges.length > 0) {
    const adj = new Map<string, string[]>();
    for (const ch of input.chapters) adj.set(ch.id, []);
    for (const e of input.edges) {
      const neighbors = adj.get(e.sourceChapterId);
      if (neighbors) neighbors.push(e.targetChapterId);
    }

    const visited = new Set<string>();
    const stack = new Set<string>();
    let hasCycle = false;

    function dfs(node: string): void {
      if (hasCycle) return;
      visited.add(node);
      stack.add(node);
      for (const neighbor of adj.get(node) ?? []) {
        if (stack.has(neighbor)) { hasCycle = true; return; }
        if (!visited.has(neighbor)) dfs(neighbor);
      }
      stack.delete(node);
    }

    for (const ch of input.chapters) {
      if (!visited.has(ch.id)) dfs(ch.id);
    }

    if (hasCycle) {
      findings.push({
        level: 'warning',
        message: 'Cycle detected in chapter graph',
        chapterId: null,
        chapterName: null,
      });
    }
  }

  return findings;
}
