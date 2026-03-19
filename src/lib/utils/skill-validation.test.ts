import { describe, it, expect } from 'vitest';
import { validateSkill } from './skill-validation';
import type { SkillValidationInput, ValidationFinding } from './skill-validation';

// ── Helpers ───────────────────────────────────────────────────────────

function makeInput(overrides: Partial<SkillValidationInput> = {}): SkillValidationInput {
  return {
    name: 'My Skill',
    description: 'A useful skill.',
    chapters: [
      {
        id: 'ch1',
        name: 'Chapter 1',
        type: 'chapter',
        guide: 'Do this task.',
        outputDef: 'A result object.',
      },
    ],
    edges: [],
    chapterToolMap: { ch1: ['tool-a'] },
    ...overrides,
  };
}

// ── Test 1: No chapters → error ───────────────────────────────────────

describe('Test 1: no chapters error', () => {
  it('returns an error-level finding when chapters is empty', () => {
    const result = validateSkill(makeInput({ chapters: [], chapterToolMap: {} }));
    const errors = result.filter(f => f.level === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some(f => f.message.toLowerCase().includes('chapter'))).toBe(true);
  });

  it('error finding has chapterId=null and chapterName=null (skill-level)', () => {
    const result = validateSkill(makeInput({ chapters: [], chapterToolMap: {} }));
    const noChapterError = result.find(f => f.level === 'error');
    expect(noChapterError?.chapterId).toBeNull();
    expect(noChapterError?.chapterName).toBeNull();
  });
});

// ── Test 2: Chapter missing guide → error ─────────────────────────────

describe('Test 2: chapter-type missing guide → error', () => {
  it('returns an error when a chapter-type node has empty guide', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: '', outputDef: 'something' }],
        chapterToolMap: { ch1: ['tool-a'] },
      })
    );
    const errors = result.filter(f => f.level === 'error');
    expect(errors.some(f => f.chapterId === 'ch1')).toBe(true);
  });

  it('returns an error when a chapter-type node has whitespace-only guide', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: '   ', outputDef: 'something' }],
        chapterToolMap: { ch1: ['tool-a'] },
      })
    );
    const errors = result.filter(f => f.level === 'error');
    expect(errors.some(f => f.chapterId === 'ch1')).toBe(true);
  });

  it('error finding has chapterId and chapterName set to the chapter values', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'My Chapter', type: 'chapter', guide: '', outputDef: 'something' }],
        chapterToolMap: { ch1: ['tool-a'] },
      })
    );
    const guideError = result.find(f => f.level === 'error' && f.chapterId === 'ch1');
    expect(guideError?.chapterId).toBe('ch1');
    expect(guideError?.chapterName).toBe('My Chapter');
  });
});

// ── Test 3: Condition missing conditionText → error ───────────────────

describe('Test 3: condition-type missing conditionText → error', () => {
  it('returns an error when a condition node has empty conditionText', () => {
    const result = validateSkill(
      makeInput({
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'guide text', outputDef: 'output' },
          { id: 'cond1', name: 'My Condition', type: 'condition', conditionText: '' },
        ],
        chapterToolMap: { ch1: ['tool-a'], cond1: [] },
        edges: [{ sourceChapterId: 'ch1', targetChapterId: 'cond1' }],
      })
    );
    const errors = result.filter(f => f.level === 'error');
    expect(errors.some(f => f.chapterId === 'cond1')).toBe(true);
  });

  it('returns an error when a condition node has whitespace-only conditionText', () => {
    const result = validateSkill(
      makeInput({
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'guide text', outputDef: 'output' },
          { id: 'cond1', name: 'My Condition', type: 'condition', conditionText: '   ' },
        ],
        chapterToolMap: { ch1: ['tool-a'], cond1: [] },
        edges: [{ sourceChapterId: 'ch1', targetChapterId: 'cond1' }],
      })
    );
    const errors = result.filter(f => f.level === 'error');
    expect(errors.some(f => f.chapterId === 'cond1')).toBe(true);
  });

  it('error finding has chapterId and chapterName of the condition', () => {
    const result = validateSkill(
      makeInput({
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'guide text', outputDef: 'output' },
          { id: 'cond1', name: 'My Condition', type: 'condition', conditionText: '' },
        ],
        chapterToolMap: { ch1: ['tool-a'], cond1: [] },
        edges: [{ sourceChapterId: 'ch1', targetChapterId: 'cond1' }],
      })
    );
    const condError = result.find(f => f.level === 'error' && f.chapterId === 'cond1');
    expect(condError?.chapterId).toBe('cond1');
    expect(condError?.chapterName).toBe('My Condition');
  });
});

// ── Test 4: Chapter-type with no tools → error ────────────────────────

describe('Test 4: chapter-type with no tools → error', () => {
  it('returns an error when a chapter-type node has no entry in chapterToolMap', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'output' }],
        chapterToolMap: {},
      })
    );
    const errors = result.filter(f => f.level === 'error');
    expect(errors.some(f => f.chapterId === 'ch1')).toBe(true);
  });

  it('returns an error when a chapter-type node has an empty tools array', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'output' }],
        chapterToolMap: { ch1: [] },
      })
    );
    const errors = result.filter(f => f.level === 'error');
    expect(errors.some(f => f.chapterId === 'ch1')).toBe(true);
  });

  it('error finding has chapterId and chapterName of the chapter', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'output' }],
        chapterToolMap: { ch1: [] },
      })
    );
    const toolError = result.find(f => f.level === 'error' && f.chapterId === 'ch1');
    expect(toolError?.chapterId).toBe('ch1');
    expect(toolError?.chapterName).toBe('Chapter 1');
  });
});

// ── Test 5: Early return after "no chapters" ──────────────────────────

describe('Test 5: early return after no-chapters error', () => {
  it('returns only the no-chapters error and no chapter-level findings when chapters is empty', () => {
    const result = validateSkill(makeInput({ chapters: [], chapterToolMap: {} }));
    // No chapter-specific (chapterId != null) findings should exist
    expect(result.every(f => f.chapterId === null)).toBe(true);
  });
});

// ── Test 6: No custom name → warning ─────────────────────────────────

describe('Test 6: no custom name → warning', () => {
  it('returns a warning when name is empty', () => {
    const result = validateSkill(makeInput({ name: '' }));
    const warnings = result.filter(f => f.level === 'warning');
    expect(warnings.some(f => f.chapterId === null && f.message.toLowerCase().includes('name'))).toBe(true);
  });

  it('returns a warning when name is "Untitled Skill"', () => {
    const result = validateSkill(makeInput({ name: 'Untitled Skill' }));
    const warnings = result.filter(f => f.level === 'warning');
    expect(warnings.some(f => f.chapterId === null)).toBe(true);
  });

  it('warning for name has chapterId=null and chapterName=null', () => {
    const result = validateSkill(makeInput({ name: '' }));
    const nameWarning = result.find(f => f.level === 'warning' && f.message.toLowerCase().includes('name'));
    expect(nameWarning?.chapterId).toBeNull();
    expect(nameWarning?.chapterName).toBeNull();
  });
});

// ── Test 7: No description → warning ─────────────────────────────────

describe('Test 7: no description → warning', () => {
  it('returns a warning when description is empty', () => {
    const result = validateSkill(makeInput({ description: '' }));
    const warnings = result.filter(f => f.level === 'warning');
    expect(warnings.some(f => f.chapterId === null && f.message.toLowerCase().includes('description'))).toBe(true);
  });

  it('returns a warning when description is whitespace-only', () => {
    const result = validateSkill(makeInput({ description: '   ' }));
    const warnings = result.filter(f => f.level === 'warning');
    expect(warnings.some(f => f.chapterId === null)).toBe(true);
  });

  it('warning for description has chapterId=null and chapterName=null', () => {
    const result = validateSkill(makeInput({ description: '' }));
    const descWarning = result.find(f => f.level === 'warning' && f.message.toLowerCase().includes('description'));
    expect(descWarning?.chapterId).toBeNull();
    expect(descWarning?.chapterName).toBeNull();
  });
});

// ── Test 8: Chapter without outputDef → warning ───────────────────────

describe('Test 8: chapter without outputDef → warning', () => {
  it('returns a warning when a chapter has empty outputDef', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: '' }],
        chapterToolMap: { ch1: ['tool-a'] },
      })
    );
    const warnings = result.filter(f => f.level === 'warning');
    expect(warnings.some(f => f.chapterId === 'ch1')).toBe(true);
  });

  it('returns a warning when a chapter has whitespace-only outputDef', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: '   ' }],
        chapterToolMap: { ch1: ['tool-a'] },
      })
    );
    const warnings = result.filter(f => f.level === 'warning');
    expect(warnings.some(f => f.chapterId === 'ch1')).toBe(true);
  });

  it('warning has chapterId and chapterName of the chapter', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'My Chapter', type: 'chapter', guide: 'do it', outputDef: '' }],
        chapterToolMap: { ch1: ['tool-a'] },
      })
    );
    const outputWarning = result.find(f => f.level === 'warning' && f.chapterId === 'ch1');
    expect(outputWarning?.chapterId).toBe('ch1');
    expect(outputWarning?.chapterName).toBe('My Chapter');
  });
});

// ── Test 9: Not connected → warning (>1 chapter, 0 edges) ────────────

describe('Test 9: not connected → warning', () => {
  it('returns a warning when >1 chapter and 0 edges', () => {
    const result = validateSkill(
      makeInput({
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'out' },
          { id: 'ch2', name: 'Chapter 2', type: 'chapter', guide: 'do that', outputDef: 'out2' },
        ],
        chapterToolMap: { ch1: ['tool-a'], ch2: ['tool-b'] },
        edges: [],
      })
    );
    const warnings = result.filter(f => f.level === 'warning');
    expect(warnings.some(f => f.chapterId === null && f.message.toLowerCase().includes('connect'))).toBe(true);
  });

  it('not-connected warning has chapterId=null and chapterName=null', () => {
    const result = validateSkill(
      makeInput({
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'out' },
          { id: 'ch2', name: 'Chapter 2', type: 'chapter', guide: 'do that', outputDef: 'out2' },
        ],
        chapterToolMap: { ch1: ['tool-a'], ch2: ['tool-b'] },
        edges: [],
      })
    );
    const connWarning = result.find(f => f.level === 'warning' && f.message.toLowerCase().includes('connect'));
    expect(connWarning?.chapterId).toBeNull();
    expect(connWarning?.chapterName).toBeNull();
  });
});

// ── Test 10: Cycle detected → warning ────────────────────────────────

describe('Test 10: cycle detected → warning', () => {
  it('returns a warning when a cycle exists in the DAG', () => {
    // ch1 → ch2 → ch1 (cycle)
    const result = validateSkill(
      makeInput({
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'out' },
          { id: 'ch2', name: 'Chapter 2', type: 'chapter', guide: 'do that', outputDef: 'out2' },
        ],
        chapterToolMap: { ch1: ['tool-a'], ch2: ['tool-b'] },
        edges: [
          { sourceChapterId: 'ch1', targetChapterId: 'ch2' },
          { sourceChapterId: 'ch2', targetChapterId: 'ch1' },
        ],
      })
    );
    const warnings = result.filter(f => f.level === 'warning');
    expect(warnings.some(f => f.chapterId === null && f.message.toLowerCase().includes('cycle'))).toBe(true);
  });

  it('cycle warning has chapterId=null and chapterName=null', () => {
    const result = validateSkill(
      makeInput({
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'out' },
          { id: 'ch2', name: 'Chapter 2', type: 'chapter', guide: 'do that', outputDef: 'out2' },
        ],
        chapterToolMap: { ch1: ['tool-a'], ch2: ['tool-b'] },
        edges: [
          { sourceChapterId: 'ch1', targetChapterId: 'ch2' },
          { sourceChapterId: 'ch2', targetChapterId: 'ch1' },
        ],
      })
    );
    const cycleWarning = result.find(f => f.level === 'warning' && f.message.toLowerCase().includes('cycle'));
    expect(cycleWarning?.chapterId).toBeNull();
    expect(cycleWarning?.chapterName).toBeNull();
  });
});

// ── Test 11: Finding shape ────────────────────────────────────────────

describe('Test 11: every finding has required fields', () => {
  it('all findings have level, message, chapterId, chapterName', () => {
    const result = validateSkill(makeInput({ name: '', description: '', chapters: [], chapterToolMap: {} }));
    for (const f of result) {
      expect(f).toHaveProperty('level');
      expect(f).toHaveProperty('message');
      expect(f).toHaveProperty('chapterId');
      expect(f).toHaveProperty('chapterName');
      expect(typeof f.message).toBe('string');
    }
  });
});

// ── Test 12: No 'ok' level findings ──────────────────────────────────

describe('Test 12: no ok-level findings are ever returned', () => {
  it('returns no ok-level findings for a valid skill', () => {
    const result = validateSkill(makeInput());
    expect(result.every(f => f.level !== 'ok')).toBe(true);
  });

  it('returns no ok-level findings even when there are errors', () => {
    const result = validateSkill(makeInput({ chapters: [], chapterToolMap: {} }));
    expect(result.every(f => f.level !== 'ok')).toBe(true);
  });
});

// ── Test 13: Skill-level findings have null chapter fields ────────────

describe('Test 13: skill-level findings have chapterId=null, chapterName=null', () => {
  it('name warning has null chapter fields', () => {
    const result = validateSkill(makeInput({ name: '' }));
    const finding = result.find(f => f.message.toLowerCase().includes('name'));
    expect(finding?.chapterId).toBeNull();
    expect(finding?.chapterName).toBeNull();
  });

  it('description warning has null chapter fields', () => {
    const result = validateSkill(makeInput({ description: '' }));
    const finding = result.find(f => f.message.toLowerCase().includes('description'));
    expect(finding?.chapterId).toBeNull();
    expect(finding?.chapterName).toBeNull();
  });

  it('no-chapters error has null chapter fields', () => {
    const result = validateSkill(makeInput({ chapters: [], chapterToolMap: {} }));
    const finding = result.find(f => f.level === 'error');
    expect(finding?.chapterId).toBeNull();
    expect(finding?.chapterName).toBeNull();
  });
});

// ── Test 14: Chapter-level findings have chapterId and chapterName ────

describe('Test 14: chapter-level findings have chapterId and chapterName set', () => {
  it('guide error has chapterId and chapterName of the specific chapter', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'abc', name: 'Named Chapter', type: 'chapter', guide: '', outputDef: 'out' }],
        chapterToolMap: { abc: ['tool-a'] },
      })
    );
    const finding = result.find(f => f.level === 'error' && f.chapterId === 'abc');
    expect(finding?.chapterId).toBe('abc');
    expect(finding?.chapterName).toBe('Named Chapter');
  });

  it('tools error has chapterId and chapterName of the specific chapter', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'abc', name: 'Named Chapter', type: 'chapter', guide: 'guide', outputDef: 'out' }],
        chapterToolMap: { abc: [] },
      })
    );
    const finding = result.find(f => f.level === 'error' && f.chapterId === 'abc');
    expect(finding?.chapterId).toBe('abc');
    expect(finding?.chapterName).toBe('Named Chapter');
  });
});

// ── Test 15: Condition nodes NOT checked for tools ────────────────────

describe('Test 15: condition nodes are not checked for tools', () => {
  it('does not produce a tools error for condition-type nodes', () => {
    const result = validateSkill(
      makeInput({
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'out' },
          { id: 'cond1', name: 'My Condition', type: 'condition', conditionText: 'Is this done?' },
        ],
        chapterToolMap: { ch1: ['tool-a'], cond1: [] },
        edges: [{ sourceChapterId: 'ch1', targetChapterId: 'cond1' }],
      })
    );
    // No tools error for the condition node
    const condToolError = result.find(
      f => f.level === 'error' && f.chapterId === 'cond1' && f.message.toLowerCase().includes('tool')
    );
    expect(condToolError).toBeUndefined();
  });

  it('does not produce a guide error for condition-type nodes', () => {
    const result = validateSkill(
      makeInput({
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'out' },
          { id: 'cond1', name: 'My Condition', type: 'condition', conditionText: 'Is this done?' },
        ],
        chapterToolMap: { ch1: ['tool-a'], cond1: [] },
        edges: [{ sourceChapterId: 'ch1', targetChapterId: 'cond1' }],
      })
    );
    // No guide error for condition node
    const condGuideError = result.find(
      f => f.level === 'error' && f.chapterId === 'cond1' && f.message.toLowerCase().includes('instruction')
    );
    expect(condGuideError).toBeUndefined();
  });
});

// ── Test 16: Single chapter with 0 edges → no "not connected" warning ──

describe('Test 16: single chapter with 0 edges does not trigger not-connected warning', () => {
  it('does not return a not-connected warning for a single chapter', () => {
    const result = validateSkill(makeInput());
    const connWarning = result.find(
      f => f.level === 'warning' && f.message.toLowerCase().includes('connect')
    );
    expect(connWarning).toBeUndefined();
  });
});

// ── Test 17: Valid skill returns empty array ───────────────────────────

describe('Test 17: valid skill returns empty array', () => {
  it('returns [] for a skill with name, description, chapters with guide, tools, and outputDef', () => {
    const result = validateSkill(makeInput());
    expect(result).toEqual([]);
  });

  it('returns [] for multi-chapter skill with edges and no cycles', () => {
    const result = validateSkill(
      makeInput({
        name: 'My Skill',
        description: 'A useful skill.',
        chapters: [
          { id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: 'do it', outputDef: 'out' },
          { id: 'ch2', name: 'Chapter 2', type: 'chapter', guide: 'do that', outputDef: 'out2' },
        ],
        chapterToolMap: { ch1: ['tool-a'], ch2: ['tool-b'] },
        edges: [{ sourceChapterId: 'ch1', targetChapterId: 'ch2' }],
      })
    );
    expect(result).toEqual([]);
  });
});

// ── Test 18: Multiple errors on same chapter ──────────────────────────

describe('Test 18: multiple errors on same chapter all have that chapter id', () => {
  it('both guide error and tools error share the same chapterId', () => {
    const result = validateSkill(
      makeInput({
        chapters: [{ id: 'ch1', name: 'Chapter 1', type: 'chapter', guide: '', outputDef: 'out' }],
        chapterToolMap: { ch1: [] },
      })
    );
    const ch1Errors = result.filter(f => f.level === 'error' && f.chapterId === 'ch1');
    // Should have at least 2 errors: missing guide + missing tools
    expect(ch1Errors.length).toBeGreaterThanOrEqual(2);
    for (const err of ch1Errors) {
      expect(err.chapterId).toBe('ch1');
      expect(err.chapterName).toBe('Chapter 1');
    }
  });
});
