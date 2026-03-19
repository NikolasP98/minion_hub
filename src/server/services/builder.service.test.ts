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
      { chapterId: 'ch-1' },
      { chapterId: 'ch-2' },
      { chapterId: 'ch-3' },
    ];
    const edges = [
      { sourceChapterId: 'ch-1', targetChapterId: 'ch-2' },
      { sourceChapterId: 'ch-2', targetChapterId: 'ch-3' },
    ];

    resolveSequence([
      [skill],      // getBuiltSkill
      chapters,     // getChapters
      allTools,     // inArray batch tool query (single call)
      edges,        // getChapterEdges
    ]);

    const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');

    // Single select call for tools (not 3 separate calls)
    expect(db.select).toHaveBeenCalledTimes(4); // getBuiltSkill + getChapters + tool batch + getChapterEdges
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects a disconnected subgraph (node reachable only from isolated node)', async () => {
    const { db, resolveSequence } = createMockDb();
    const skill = { id: 'skill-1', name: 'My Skill', tenantId: 't1' };
    // Graph: A->B (connected), C->D (disconnected subgraph — C has no incoming, but is not root reachable from A)
    const chapters = [
      { id: 'ch-A', name: 'Node A', type: 'chapter', guide: 'Do A', conditionText: '' },
      { id: 'ch-B', name: 'Node B', type: 'chapter', guide: 'Do B', conditionText: '' },
      { id: 'ch-C', name: 'Node C', type: 'chapter', guide: 'Do C', conditionText: '' },
      { id: 'ch-D', name: 'Node D', type: 'chapter', guide: 'Do D', conditionText: '' },
    ];
    const allTools = [
      { chapterId: 'ch-A' },
      { chapterId: 'ch-B' },
      { chapterId: 'ch-C' },
      { chapterId: 'ch-D' },
    ];
    // Two disconnected chains: A->B and C->D
    const edges = [
      { sourceChapterId: 'ch-A', targetChapterId: 'ch-B' },
      { sourceChapterId: 'ch-C', targetChapterId: 'ch-D' },
    ];

    resolveSequence([
      [skill],
      chapters,
      allTools,
      edges,
    ]);

    const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('disconnected'))).toBe(true);
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
      { chapterId: 'ch-A' },
      { chapterId: 'ch-B' },
    ];
    const edges = [
      { sourceChapterId: 'ch-A', targetChapterId: 'ch-B' },
      { sourceChapterId: 'ch-B', targetChapterId: 'ch-A' },
    ];

    resolveSequence([
      [skill],
      chapters,
      allTools,
      edges,
    ]);

    const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');

    expect(result.errors.some(e => e.toLowerCase().includes('disconnected'))).toBe(false);
  });

  it('includes chapter name in error when chapter has no tools assigned', async () => {
    const { db, resolveSequence } = createMockDb();
    const skill = { id: 'skill-1', name: 'My Skill', tenantId: 't1' };
    const chapters = [
      { id: 'ch-1', name: 'Missing Tools Chapter', type: 'chapter', guide: 'Do it', conditionText: '' },
    ];
    // Empty tools result — no tools for ch-1
    const allTools: unknown[] = [];
    const edges: unknown[] = [];

    resolveSequence([
      [skill],
      chapters,
      allTools,
      edges,
    ]);

    const result = await validateSkillForPublish({ db, tenantId: 't1' }, 'skill-1');

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Missing Tools Chapter'))).toBe(true);
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
