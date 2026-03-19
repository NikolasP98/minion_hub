import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateSkillForPublish,
  setChapterTools,
  setAgentBuiltSkills,
} from './builder.service';
import { createMockDb } from '$server/test-utils/mock-db';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-id-00000001',
  nowMs: () => 1_700_000_000_000,
}));

// ── validateSkillForPublish ───────────────────────────────────────────

describe('validateSkillForPublish', () => {
  it('uses exactly 1 SELECT query for tool check when there are multiple chapter-type nodes', async () => {
    const { db, resolveSequence } = createMockDb();
    const skill = { id: 'skill-1', name: 'My Skill', tenantId: 't1' };
    const chapters = [
      { id: 'ch-1', name: 'Chapter A', type: 'chapter', guide: 'Do A', conditionText: '' },
      { id: 'ch-2', name: 'Chapter B', type: 'chapter', guide: 'Do B', conditionText: '' },
      { id: 'ch-3', name: 'Chapter C', type: 'chapter', guide: 'Do C', conditionText: '' },
    ];
    const allTools = [
      { chapterId: 'ch-1', toolId: 't1' },
      { chapterId: 'ch-2', toolId: 't2' },
      { chapterId: 'ch-3', toolId: 't3' },
    ];
    const edges = [
      { sourceChapterId: 'ch-1', targetChapterId: 'ch-2' },
      { sourceChapterId: 'ch-2', targetChapterId: 'ch-3' },
    ];

    resolveSequence([
      [skill],      // getBuiltSkill
      chapters,     // getChapters
      edges,        // getChapterEdges (chapters.length > 1)
      allTools,     // batch tool query via ctx.db.select().from(builtChapterTools)
    ]);

    const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');

    // 4 select calls: getBuiltSkill + getChapters + getChapterEdges + tool batch
    expect(db.select).toHaveBeenCalledTimes(4);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('treats disconnected subgraph (cycle island) as valid — cycles/disconnected are warnings, not errors', async () => {
    const { db, resolveSequence } = createMockDb();
    const skill = { id: 'skill-1', name: 'My Skill', tenantId: 't1' };
    // Graph: main chain C->D (C is a root), and a disconnected cycle A<->B.
    // The shared validation module classifies cycles and disconnected nodes as warnings,
    // not errors — they don't block publish at the server gate.
    const chapters = [
      { id: 'ch-A', name: 'Node A', type: 'chapter', guide: 'Do A', conditionText: '' },
      { id: 'ch-B', name: 'Node B', type: 'chapter', guide: 'Do B', conditionText: '' },
      { id: 'ch-C', name: 'Node C', type: 'chapter', guide: 'Do C', conditionText: '' },
      { id: 'ch-D', name: 'Node D', type: 'chapter', guide: 'Do D', conditionText: '' },
    ];
    const allTools = [
      { chapterId: 'ch-A', toolId: 't1' },
      { chapterId: 'ch-B', toolId: 't2' },
      { chapterId: 'ch-C', toolId: 't3' },
      { chapterId: 'ch-D', toolId: 't4' },
    ];
    // C->D (main connected chain), A->B->A (disconnected cycle island)
    const edges = [
      { sourceChapterId: 'ch-C', targetChapterId: 'ch-D' },
      { sourceChapterId: 'ch-A', targetChapterId: 'ch-B' },
      { sourceChapterId: 'ch-B', targetChapterId: 'ch-A' },
    ];

    resolveSequence([
      [skill],
      chapters,
      edges,        // getChapterEdges (chapters.length > 1)
      allTools,     // batch tool query
    ]);

    const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');

    // Cycles and disconnected nodes are warnings in the shared module — no errors block publish
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('does NOT produce a disconnected-node error for a pure cycle (all nodes have incoming edges)', async () => {
    const { db, resolveSequence } = createMockDb();
    const skill = { id: 'skill-1', name: 'My Skill', tenantId: 't1' };
    // Pure cycle: A->B->A (all nodes have incoming edges, roots.length === 0)
    const chapters = [
      { id: 'ch-A', name: 'Node A', type: 'chapter', guide: 'Do A', conditionText: '' },
      { id: 'ch-B', name: 'Node B', type: 'chapter', guide: 'Do B', conditionText: '' },
    ];
    const allTools = [
      { chapterId: 'ch-A', toolId: 't1' },
      { chapterId: 'ch-B', toolId: 't2' },
    ];
    const edges = [
      { sourceChapterId: 'ch-A', targetChapterId: 'ch-B' },
      { sourceChapterId: 'ch-B', targetChapterId: 'ch-A' },
    ];

    resolveSequence([
      [skill],
      chapters,
      edges,        // getChapterEdges (chapters.length > 1)
      allTools,     // batch tool query
    ]);

    const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');

    expect(result.errors.some(e => e.toLowerCase().includes('not connected'))).toBe(false);
  });

  it('includes "no tools" error when chapter has no tools assigned', async () => {
    const { db, resolveSequence } = createMockDb();
    const skill = { id: 'skill-1', name: 'My Skill', tenantId: 't1' };
    const chapters = [
      { id: 'ch-1', name: 'Missing Tools Chapter', type: 'chapter', guide: 'Do it', conditionText: '' },
    ];
    // Empty tools result — no tools for ch-1
    const allTools: unknown[] = [];

    resolveSequence([
      [skill],
      chapters,
      // No edges call (chapters.length === 1, so edges skipped)
      allTools,     // batch tool query returns empty
    ]);

    const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');

    expect(result.valid).toBe(false);
    // Shared module reports 'Chapter has no tools assigned' — chapter name is in the finding's chapterName field
    expect(result.errors.some(e => e.toLowerCase().includes('no tools'))).toBe(true);
  });

  it('skips the tool check entirely when all nodes are condition-type', async () => {
    const { db, resolveSequence } = createMockDb();
    const skill = { id: 'skill-1', name: 'My Skill', tenantId: 't1' };
    const chapters = [
      { id: 'ch-1', name: 'Cond A', type: 'condition', guide: '', conditionText: 'Is it done?' },
    ];
    // No tool query should be made
    resolveSequence([
      [skill],
      chapters,
      // No tool result needed since condition-only skips tool check
    ]);

    const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');

    // select called for: getBuiltSkill + getChapters only (no tool batch query)
    expect(db.select).toHaveBeenCalledTimes(2);
    // condition node missing conditionText would be an error — but here conditionText is set
    expect(result.errors.some(e => e.toLowerCase().includes('tool'))).toBe(false);
  });
});

// ── setChapterTools ────────────────────────────────────────────────────

describe('setChapterTools', () => {
  it('calls db.insert exactly once for 3 toolIds (not 3 times)', async () => {
    const { db } = createMockDb();
    await setChapterTools({ db, tenantId: 't1' }, 'ch-1', ['tool-a', 'tool-b', 'tool-c']);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('calls db.delete but NOT db.insert when toolIds is empty', async () => {
    const { db } = createMockDb();
    await setChapterTools({ db, tenantId: 't1' }, 'ch-1', []);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ── setAgentBuiltSkills ────────────────────────────────────────────────

describe('setAgentBuiltSkills', () => {
  it('calls db.insert exactly once for 3 skillIds (not 3 times)', async () => {
    const { db } = createMockDb();
    await setAgentBuiltSkills({ db, tenantId: 't1' }, 'agent-1', 'server-1', ['skill-a', 'skill-b', 'skill-c']);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('calls db.delete but NOT db.insert when skillIds is empty', async () => {
    const { db } = createMockDb();
    await setAgentBuiltSkills({ db, tenantId: 't1' }, 'agent-1', 'server-1', []);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
