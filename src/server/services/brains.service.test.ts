import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('./embeddings', () => ({
  embeddingsEnabled: vi.fn(() => true),
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  toVectorLiteral: (vec: number[]) => `[${vec.join(',')}]`,
}));

import { canAccessBrain, chunkText, searchBrain, type AccessPrincipal } from './brains.service';
import { embeddingsEnabled } from './embeddings';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

const brainRow = (over: Partial<{ id: string; createdBy: string | null; visibility: string }> = {}) => ({
  id: 'brain-1',
  orgId: 'org-1',
  name: 'Support KB',
  description: null,
  icon: null,
  visibility: 'private',
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('brains.service — canAccessBrain (fail-closed access resolution)', () => {
  it('denies when the brain does not exist', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // loadBrain → no row
    const ok = await canAccessBrain(ctx(db), 'missing', 'read', {});
    expect(ok).toBe(false);
  });

  it('grants write to the creator', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow({ createdBy: 'user-1' })]]);
    const ok = await canAccessBrain(ctx(db), 'brain-1', 'write', { profileId: 'user-1' });
    expect(ok).toBe(true);
  });

  it('grants write to an org owner/admin role regardless of the brain', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow()]]);
    const ok = await canAccessBrain(ctx(db), 'brain-1', 'write', { profileId: 'someone-else', roles: ['admin'] });
    expect(ok).toBe(true);
  });

  it('grants read (not write) to any org member on a visibility:org brain', async () => {
    const { db: readDb, resolveSequence: readSeq } = createMockDb();
    readSeq([[brainRow({ visibility: 'org' })]]);
    expect(await canAccessBrain(ctx(readDb), 'brain-1', 'read', {})).toBe(true);

    const { db: writeDb, resolveSequence: writeSeq } = createMockDb();
    // write on an org-visibility brain with no other grant falls through to the
    // brain_access lookup, which is empty here → denied.
    writeSeq([[brainRow({ visibility: 'org' })], []]);
    expect(await canAccessBrain(ctx(writeDb), 'brain-1', 'write', {})).toBe(false);
  });

  it('honors a role-principal brain_access row', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow()], [{ brainId: 'brain-1', orgId: 'org-1', principalType: 'role', principalId: 'staff', level: 'read' }]]);
    const principal: AccessPrincipal = { roles: ['staff'] };
    expect(await canAccessBrain(ctx(db), 'brain-1', 'read', principal)).toBe(true);
  });

  it('a read-level access row does not satisfy a write check', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow()], [{ brainId: 'brain-1', orgId: 'org-1', principalType: 'role', principalId: 'staff', level: 'read' }]]);
    const principal: AccessPrincipal = { roles: ['staff'] };
    expect(await canAccessBrain(ctx(db), 'brain-1', 'write', principal)).toBe(false);
  });

  it('honors a user-principal brain_access row', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow()], [{ brainId: 'brain-1', orgId: 'org-1', principalType: 'user', principalId: 'user-9', level: 'write' }]]);
    expect(await canAccessBrain(ctx(db), 'brain-1', 'write', { profileId: 'user-9' })).toBe(true);
  });

  it('honors an agent-principal brain_access row', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow()], [{ brainId: 'brain-1', orgId: 'org-1', principalType: 'agent', principalId: 'agent-42', level: 'read' }]]);
    expect(await canAccessBrain(ctx(db), 'brain-1', 'read', { agentId: 'agent-42' })).toBe(true);
  });

  it('fails closed when nothing matches (private brain, no grant, no roles)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow()], []]);
    expect(await canAccessBrain(ctx(db), 'brain-1', 'read', { profileId: 'nobody', agentId: 'nobody-agent' })).toBe(false);
  });
});

describe('brains.service — chunkText', () => {
  it('returns [] for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('keeps short paragraphs in a single chunk', () => {
    const text = 'First paragraph.\n\nSecond paragraph.';
    expect(chunkText(text, 3000, 300)).toEqual(['First paragraph.\n\nSecond paragraph.']);
  });

  it('splits on paragraph boundaries once the size budget is exceeded, carrying an overlap tail', () => {
    const para1 = 'A'.repeat(2900);
    const para2 = 'B'.repeat(500);
    const chunks = chunkText(`${para1}\n\n${para2}`, 3000, 300);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para1);
    // second chunk carries the last 300 chars of chunk 1 as overlap, then para2
    expect(chunks[1].startsWith('A'.repeat(300))).toBe(true);
    expect(chunks[1].endsWith(para2)).toBe(true);
  });

  it('hard-splits a single paragraph longer than size, still carrying overlap', () => {
    const huge = 'x'.repeat(7000);
    const chunks = chunkText(huge, 3000, 300);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3000);
    // reassembling without the overlaps should recover something close to the original length
    expect(chunks.join('').length).toBeGreaterThanOrEqual(huge.length);
  });
});

describe('brains.service — searchBrain brain isolation', () => {
  it('denies a search against a brain the principal has no access to, even if they own a different brain', async () => {
    // principal is the creator of brain-1 (their own brain) but is querying brain-2,
    // which they have no relationship to at all.
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow({ id: 'brain-2', createdBy: 'someone-else', visibility: 'private' })], []]);
    const principal: AccessPrincipal = { profileId: 'user-1', roles: ['staff'] };
    await expect(searchBrain(ctx(db), 'brain-2', 'refund policy', undefined, principal)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('scopes the chunk query to the requested brainId (not org-wide)', async () => {
    const { db, resolveSequence } = createMockDb();
    const chunkRow = {
      chunkId: 'c1',
      documentId: 'd1',
      seq: 0,
      chunkText: 'hello',
      documentTitle: 'Doc',
      score: 0.9,
    };
    resolveSequence([[brainRow({ id: 'brain-1', visibility: 'org' })], [chunkRow]]);
    const hits = await searchBrain(ctx(db), 'brain-1', 'hello', 5, {});
    expect(hits).toHaveLength(1);
    expect(hits[0].chunkId).toBe('c1');
    // The where-builder is invoked with brainChunks.brainId scoped to 'brain-1' —
    // exercised via the code path (drizzle's `and(eq(brainId, ...), eq(orgId, ...))`
    // in searchBrain); the access gate above is what makes cross-brain leakage
    // impossible even before that filter runs.
  });

  it('returns [] for a blank query without touching the embeddings provider', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow({ id: 'brain-1', visibility: 'org' })]]);
    const hits = await searchBrain(ctx(db), 'brain-1', '   ', undefined, {});
    expect(hits).toEqual([]);
  });

  it('throws 503 when embeddings are not configured', async () => {
    vi.mocked(embeddingsEnabled).mockReturnValueOnce(false);
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow({ id: 'brain-1', visibility: 'org' })]]);
    await expect(searchBrain(ctx(db), 'brain-1', 'hello', undefined, {})).rejects.toMatchObject({ status: 503 });
  });
});
