import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { brainSources } from '$server/db/pg-schema/brains';

const canAccessBrain = vi.fn();
const recordAudit = vi.fn();

vi.mock('./brains.service', () => ({ canAccessBrain }));
vi.mock('./activity.service', () => ({ recordAudit }));

const { setFocusedBrainSourceMembership } = await import('./brain-corpus.service');

const brainId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const principal = { profileId: 'profile-1', roles: ['manager'] };
const actor = { id: 'profile-1', name: 'Ada' };

beforeEach(() => {
  vi.clearAllMocks();
  canAccessBrain.mockResolvedValue(true);
  recordAudit.mockResolvedValue(undefined);
});

describe('Focused Brain source membership', () => {
  it('attaches an org-scoped shared source without touching corpus rows', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: brainId, kind: 'focused' }],
      [{ id: sourceId, config: {} }],
      [{ sourceId }],
    ]);

    const result = await setFocusedBrainSourceMembership(
      { db: db as never, tenantId: 'org-1', profileId: 'profile-1' },
      brainId,
      sourceId,
      true,
      principal,
      actor,
    );

    expect(result).toEqual({ sourceId, member: true, changed: true });
    expect(db.insert).toHaveBeenCalledWith(brainSources);
    expect(db.delete).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledOnce();
  });

  it('keeps repeated attach and detach operations idempotent', async () => {
    const attached = createMockDb();
    attached.resolveSequence([
      [{ id: brainId, kind: 'focused' }],
      [{ id: sourceId, config: {} }],
      [],
    ]);
    await expect(
      setFocusedBrainSourceMembership(
        { db: attached.db as never, tenantId: 'org-1' },
        brainId,
        sourceId,
        true,
        principal,
        actor,
      ),
    ).resolves.toEqual({ sourceId, member: true, changed: false });

    const detached = createMockDb();
    detached.resolveSequence([
      [{ id: brainId, kind: 'focused' }],
      [{ id: sourceId, config: {} }],
      [],
    ]);
    await expect(
      setFocusedBrainSourceMembership(
        { db: detached.db as never, tenantId: 'org-1' },
        brainId,
        sourceId,
        false,
        principal,
        actor,
      ),
    ).resolves.toEqual({ sourceId, member: false, changed: false });

    expect(detached.db.delete).toHaveBeenCalledWith(brainSources);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('detaches only the reference and records the change', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: brainId, kind: 'focused' }],
      [{ id: sourceId, config: {} }],
      [{ sourceId }],
    ]);

    const result = await setFocusedBrainSourceMembership(
      { db: db as never, tenantId: 'org-1' },
      brainId,
      sourceId,
      false,
      principal,
      actor,
    );

    expect(result).toEqual({ sourceId, member: false, changed: true });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(brainSources);
    expect(db.insert).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledOnce();
  });

  it('rejects Master Brain membership changes', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: brainId, kind: 'master' }]]);

    await expect(
      setFocusedBrainSourceMembership(
        { db: db as never, tenantId: 'org-1' },
        brainId,
        sourceId,
        true,
        principal,
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('fails closed when the source is absent from the org-scoped transaction', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: brainId, kind: 'focused' }], []]);

    await expect(
      setFocusedBrainSourceMembership(
        { db: db as never, tenantId: 'org-1' },
        brainId,
        sourceId,
        true,
        principal,
        actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('does not allow membership to broaden classified source access', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: brainId, kind: 'focused' }],
      [{ id: sourceId, config: { requiredModule: 'finance', requiredFieldLevel: 1 } }],
    ]);

    await expect(
      setFocusedBrainSourceMembership(
        { db: db as never, tenantId: 'org-1' },
        brainId,
        sourceId,
        true,
        { ...principal, searchableModules: ['finance'], fieldLevels: { finance: 0 } },
        actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('fails closed for a malformed source field-level classification', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: brainId, kind: 'focused' }],
      [{ id: sourceId, config: { requiredModule: 'finance', requiredFieldLevel: 'invalid' } }],
    ]);

    await expect(
      setFocusedBrainSourceMembership(
        { db: db as never, tenantId: 'org-1' },
        brainId,
        sourceId,
        true,
        { ...principal, searchableModules: ['finance'], fieldLevels: { finance: 99 } },
        actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('does not open a membership transaction without per-brain write access', async () => {
    canAccessBrain.mockResolvedValueOnce(false);
    const { db } = createMockDb();

    await expect(
      setFocusedBrainSourceMembership(
        { db: db as never, tenantId: 'org-1' },
        brainId,
        sourceId,
        true,
        principal,
        actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
