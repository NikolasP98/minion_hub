import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (only needed for the org-kind early-return test — every
//    other test below exercises a pure function directly). ─────────────────
const mocks = vi.hoisted(() => ({
  coreDbExecute: vi.fn(),
  withOrgCore: vi.fn(),
}));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => ({ execute: mocks.coreDbExecute }),
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: unknown, fn: (tx: unknown) => unknown) => mocks.withOrgCore(scope, fn),
}));

import {
  isRelationshipDirty,
  applyCaps,
  hasAliasCollision,
  relationshipSystemPrincipal,
  clampRelationshipResult,
  formatHeadTailEvidence,
  buildRelationshipPrompt,
  getOrgKind,
  relationshipInferenceTick,
} from './crm-relationship-inference.service';
import type { Relationship } from '$lib/components/crm/crm-relationship';

beforeEach(() => {
  vi.clearAllMocks();
});

const NOW = new Date('2026-07-23T12:00:00.000Z');
const COOLDOWN_MS = 7 * 24 * 60 * 60_000;

function relationship(overrides: Partial<Relationship> = {}): Relationship {
  return {
    label: 'mamá',
    category: 'family',
    source: 'ai',
    confidence: 0.9,
    inputSig: 'sig-1',
    inferenceVersion: 1,
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('isRelationshipDirty — dirty-gate truth table (spec R4)', () => {
  it('missing relationship → dirty', () => {
    expect(isRelationshipDirty(undefined, 'sig-1', { inferenceVersion: 1, cooldownMs: COOLDOWN_MS, now: NOW })).toBe(true);
  });

  it('user-pinned relationship → NEVER dirty, regardless of signature/version drift', () => {
    const pinned = relationship({ source: 'user', inputSig: 'stale-sig', inferenceVersion: 0 });
    expect(isRelationshipDirty(pinned, 'sig-2', { inferenceVersion: 99, cooldownMs: COOLDOWN_MS, now: NOW })).toBe(false);
  });

  it('inputSig changed → dirty', () => {
    const rel = relationship({ inputSig: 'sig-old' });
    expect(isRelationshipDirty(rel, 'sig-new', { inferenceVersion: 1, cooldownMs: COOLDOWN_MS, now: NOW })).toBe(true);
  });

  it('inferenceVersion changed → dirty', () => {
    const rel = relationship({ inferenceVersion: 1 });
    expect(isRelationshipDirty(rel, 'sig-1', { inferenceVersion: 2, cooldownMs: COOLDOWN_MS, now: NOW })).toBe(true);
  });

  it('unknown category past cooldown → dirty', () => {
    const staleUnknown = relationship({
      category: 'unknown',
      label: null,
      confidence: 0.2,
      updatedAt: new Date(NOW.getTime() - COOLDOWN_MS - 1000).toISOString(),
    });
    expect(isRelationshipDirty(staleUnknown, 'sig-1', { inferenceVersion: 1, cooldownMs: COOLDOWN_MS, now: NOW })).toBe(true);
  });

  it('unknown category within cooldown → NOT dirty (never age-based rerun of a fresh unknown)', () => {
    const freshUnknown = relationship({
      category: 'unknown',
      label: null,
      confidence: 0.2,
      updatedAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    expect(isRelationshipDirty(freshUnknown, 'sig-1', { inferenceVersion: 1, cooldownMs: COOLDOWN_MS, now: NOW })).toBe(false);
  });

  it('confident AI result, same signature+version → NOT dirty (never age-based rerun of a confident result)', () => {
    const confident = relationship({ category: 'family', confidence: 0.95 });
    expect(isRelationshipDirty(confident, 'sig-1', { inferenceVersion: 1, cooldownMs: COOLDOWN_MS, now: NOW })).toBe(false);
  });
});

describe('applyCaps — WP3 caps honored', () => {
  it('truncates to the org cap when the global budget is not the binding constraint', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => i);
    expect(applyCaps(ranked, 5, 25)).toEqual([0, 1, 2, 3, 4]);
  });

  it('truncates to the remaining global budget when it is smaller than the org cap', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => i);
    expect(applyCaps(ranked, 5, 2)).toEqual([0, 1]);
  });

  it('never returns more than the input length', () => {
    expect(applyCaps([0, 1], 5, 25)).toEqual([0, 1]);
  });

  it('a zero or negative remaining budget yields no candidates', () => {
    expect(applyCaps([0, 1, 2], 5, 0)).toEqual([]);
    expect(applyCaps([0, 1, 2], 5, -3)).toEqual([]);
  });
});

describe('hasAliasCollision (spec R3)', () => {
  it('one matching contact (itself) is not a collision', () => {
    expect(hasAliasCollision(1)).toBe(false);
    expect(hasAliasCollision(0)).toBe(false);
  });

  it('more than one matching contact is a collision', () => {
    expect(hasAliasCollision(2)).toBe(true);
  });
});

describe('relationshipSystemPrincipal (spec R1/R3 — principal shape)', () => {
  it('carries CRM-scoped module access and NO owner/admin roles or identity', () => {
    const principal = relationshipSystemPrincipal();
    expect(principal).toEqual({ searchableModules: ['crm'], fieldLevels: { crm: 1 } });
    expect(principal.roles).toBeUndefined();
    expect(principal.profileId).toBeUndefined();
    expect(principal.agentId).toBeUndefined();
  });
});

describe('clampRelationshipResult — prompt-parse clamps', () => {
  it('coerces an invented category to unknown', () => {
    const out = clampRelationshipResult(
      { label: 'algo', category: 'best_friend_forever', confidence: 0.9, evidenceChunkIds: [] },
      new Set(),
    );
    expect(out.category).toBe('unknown');
  });

  it('clamps an out-of-range confidence into [0,1]', () => {
    expect(
      clampRelationshipResult({ label: null, category: 'friend', confidence: 5, evidenceChunkIds: [] }, new Set()).confidence,
    ).toBe(1);
    expect(
      clampRelationshipResult({ label: null, category: 'friend', confidence: -2, evidenceChunkIds: [] }, new Set()).confidence,
    ).toBe(0);
    expect(
      clampRelationshipResult({ label: null, category: 'friend', confidence: Number.NaN, evidenceChunkIds: [] }, new Set()).confidence,
    ).toBe(0);
  });

  it('forces category:unknown + label:null when confidence is below the threshold', () => {
    const out = clampRelationshipResult(
      { label: 'amiga', category: 'friend', confidence: 0.3, evidenceChunkIds: [] },
      new Set(),
    );
    expect(out).toMatchObject({ label: null, category: 'unknown', confidence: 0.3 });
  });

  it('filters out invented chunk ids not actually offered to the model', () => {
    const out = clampRelationshipResult(
      { label: 'mamá', category: 'family', confidence: 0.9, evidenceChunkIds: ['real-1', 'made-up-2'] },
      new Set(['real-1']),
    );
    expect(out.evidenceChunkIds).toEqual(['real-1']);
  });

  it('a confident, valid result passes through unchanged', () => {
    const out = clampRelationshipResult(
      { label: 'amiga del trabajo', category: 'work', confidence: 0.82, evidenceChunkIds: ['c1'] },
      new Set(['c1']),
    );
    expect(out).toEqual({ label: 'amiga del trabajo', category: 'work', confidence: 0.82, evidenceChunkIds: ['c1'] });
  });
});

describe('formatHeadTailEvidence — bounded head+tail sampler formatting', () => {
  it('formats a short conversation (no gap) as one contiguous role-tagged block', () => {
    const rows = [
      { channel: 'whatsapp', chat_id: 'chat-1', direction: 'inbound', content: 'Hola', total: 2 },
      { channel: 'whatsapp', chat_id: 'chat-1', direction: 'outbound', content: 'Buenas', total: 2 },
    ];
    const text = formatHeadTailEvidence(rows, 15, 15);
    expect(text).toBe('Customer: Hola\nAgent: Buenas');
    expect(text).not.toContain('[...]');
  });

  it('inserts a [...] gap marker only when the conversation was actually truncated', () => {
    const rows = [
      { channel: 'whatsapp', chat_id: 'chat-1', direction: 'inbound', content: 'head-1', total: 5 },
      { channel: 'whatsapp', chat_id: 'chat-1', direction: 'outbound', content: 'tail-1', total: 5 },
    ];
    // headCount=1, tailCount=1, total=5 > 1+1 → truncated.
    const text = formatHeadTailEvidence(rows, 1, 1);
    expect(text).toContain('[...]');
    expect(text).toContain('head-1');
    expect(text).toContain('tail-1');
  });

  it('joins multiple conversations with a separator', () => {
    const rows = [
      { channel: 'whatsapp', chat_id: 'chat-1', direction: 'inbound', content: 'a', total: 1 },
      { channel: 'whatsapp', chat_id: 'chat-2', direction: 'inbound', content: 'b', total: 1 },
    ];
    const text = formatHeadTailEvidence(rows, 15, 15);
    expect(text).toContain('---');
    expect(text).toContain('Customer: a');
    expect(text).toContain('Customer: b');
  });

  it('empty input → empty string', () => {
    expect(formatHeadTailEvidence([], 15, 15)).toBe('');
  });
});

describe('buildRelationshipPrompt — aggregate prompt cost cap (spec F4)', () => {
  it('caps the corroboration block instead of shipping it unbounded', () => {
    const huge = 'x'.repeat(10_000);
    const prompt = buildRelationshipPrompt('Ana', '', [{ chunkId: 'c1', text: huge, occurredAt: null }]);
    // The corroboration section is everything after its header — bounded well
    // under the raw 10k input.
    const section = prompt.slice(prompt.indexOf('OTHER-CHAT MENTIONS'));
    expect(section.length).toBeLessThan(3000);
  });

  it('own evidence is unaffected by the corroboration cap', () => {
    const prompt = buildRelationshipPrompt('Ana', 'hola mamá', []);
    expect(prompt).toContain('hola mamá');
    expect(prompt).toContain('(none)');
  });
});

describe('getOrgKind', () => {
  it('reads the kind column off the global organizations registry', async () => {
    mocks.coreDbExecute.mockResolvedValueOnce([{ kind: 'personal' }]);
    await expect(getOrgKind('org-1')).resolves.toBe('personal');
  });

  it('returns null when the org has no row', async () => {
    mocks.coreDbExecute.mockResolvedValueOnce([]);
    await expect(getOrgKind('missing-org')).resolves.toBeNull();
  });
});

describe('relationshipInferenceTick — personal-only recheck (spec R7, fail closed)', () => {
  it('bails out with a zero outcome for a business org WITHOUT touching org-scoped data', async () => {
    mocks.coreDbExecute.mockResolvedValueOnce([{ kind: 'business' }]);

    const result = await relationshipInferenceTick(
      { db: {} as never, tenantId: 'org-1' },
      { remainingBudget: 25, deadline: Date.now() + 60_000 },
    );

    expect(result).toMatchObject({ skipped: 'not_personal', claimed: 0, processed: 0 });
    expect(mocks.withOrgCore).not.toHaveBeenCalled();
  });

  it('bails out with a zero outcome when an unknown/missing org kind is resolved (fail closed)', async () => {
    mocks.coreDbExecute.mockResolvedValueOnce([]);

    const result = await relationshipInferenceTick(
      { db: {} as never, tenantId: 'org-1' },
      { remainingBudget: 25, deadline: Date.now() + 60_000 },
    );

    expect(result.skipped).toBe('not_personal');
    expect(mocks.withOrgCore).not.toHaveBeenCalled();
  });

  it('honors the caller-supplied budget/deadline before even checking org kind', async () => {
    const result = await relationshipInferenceTick(
      { db: {} as never, tenantId: 'org-1' },
      { remainingBudget: 0, deadline: Date.now() + 60_000 },
    );

    expect(result).toMatchObject({ claimed: 0, processed: 0 });
    expect(mocks.coreDbExecute).not.toHaveBeenCalled();
    expect(mocks.withOrgCore).not.toHaveBeenCalled();
  });

  it('rechecks the deadline before claim acquisition (spec F4) — never claims once past it', async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-07-23T12:00:00.000Z');
      vi.setSystemTime(start);
      process.env.OPENROUTER_API_KEY = 'test-key';
      mocks.coreDbExecute.mockResolvedValueOnce([{ kind: 'personal' }]); // getOrgKind
      const deadline = start.getTime() + 10;
      // Candidate selection + master-brain lookup itself eats the whole
      // remaining budget — simulated by advancing the (faked) clock past the
      // deadline inside the withOrgCore callback, before it returns.
      mocks.withOrgCore.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date(start.getTime() + 50));
        return { ranked: [{ contactId: 'c1', relationship: undefined, inputSig: 'sig-1' }], masterBrainId: null };
      });

      const result = await relationshipInferenceTick(
        { db: {} as never, tenantId: 'org-1' },
        { remainingBudget: 25, deadline },
      );

      expect(result).toMatchObject({ claimed: 0, processed: 0 });
      // Only the candidate-select call happened — claimContacts (a second
      // withOrgCore call) was never reached.
      expect(mocks.withOrgCore).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
      vi.useRealTimers();
    }
  });
});
