/**
 * Spec 2026-10-10-hub-catalog-service-unification §Slice 3 (D4/D5): a catalog
 * service always has exactly one scheduling row, named/gated by the product.
 *
 * `computeOrgTemplate`/`nextAvailableSlug` are pure — tested directly with no
 * database. The orchestration functions (`ensureEventTypeForService`,
 * `syncEventTypeFromProduct`, `syncEventTypeForSellable`) are tested against
 * the shared chainable mock db (same style as scheduling.service.test.ts):
 * each `await tx.select/insert/update(...)` chain consumes one entry of
 * `resolveSequence`, in the exact order the function under test issues them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('./modules.service', () => ({ isModuleEnabled: vi.fn() }));
import { isModuleEnabled } from './modules.service';

import {
  computeOrgTemplate,
  nextAvailableSlug,
  ensureEventTypeForService,
  syncEventTypeFromProduct,
  syncEventTypeForSellable,
  FALLBACK_LENGTH_MINUTES,
  type TemplateRow,
} from './scheduling-catalog-sync';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const row = (id: string, length: number, kindId: string | null, createdAt: string): TemplateRow => ({
  id,
  length,
  kindId,
  createdAt: new Date(createdAt),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isModuleEnabled).mockResolvedValue(true);
});

describe('computeOrgTemplate (pure)', () => {
  it('falls back to 30 minutes, no kind, every given resource when the org has no active rows', () => {
    const template = computeOrgTemplate([], new Map(), ['res-a', 'res-b']);
    expect(template).toEqual({
      length: FALLBACK_LENGTH_MINUTES,
      kindId: null,
      resourceIds: ['res-a', 'res-b'],
    });
  });

  it('picks the signature shared by the most rows', () => {
    const rows = [
      row('et-1', 15, 'kind-a', '2026-01-01'),
      row('et-2', 15, 'kind-a', '2026-01-02'),
      row('et-3', 60, 'kind-b', '2026-01-03'),
    ];
    const byType = new Map<string, string[]>([
      ['et-1', ['milagros']],
      ['et-2', ['milagros']],
      ['et-3', ['someone-else']],
    ]);
    expect(computeOrgTemplate(rows, byType, [])).toEqual({
      length: 15,
      kindId: 'kind-a',
      resourceIds: ['milagros'],
    });
  });

  it('breaks a frequency tie with the oldest row', () => {
    const rows = [
      row('et-new', 30, null, '2026-02-01'),
      row('et-old', 45, null, '2026-01-01'),
    ];
    expect(computeOrgTemplate(rows, new Map(), [])).toMatchObject({ length: 45 });
  });
});

describe('nextAvailableSlug (pure)', () => {
  it('returns the base slug when it is free', () => {
    expect(nextAvailableSlug('lip-sculpt', new Set())).toBe('lip-sculpt');
  });

  it('suffixes -2, -3… past a clash', () => {
    expect(nextAvailableSlug('lip-sculpt', new Set(['lip-sculpt']))).toBe('lip-sculpt-2');
    expect(nextAvailableSlug('lip-sculpt', new Set(['lip-sculpt', 'lip-sculpt-2']))).toBe(
      'lip-sculpt-3',
    );
  });

  it('falls back to "service" for a name with no sluggable characters', () => {
    expect(nextAvailableSlug('', new Set())).toBe('service');
  });
});

describe('ensureEventTypeForService', () => {
  it('is a no-op when the scheduling module is off', async () => {
    vi.mocked(isModuleEnabled).mockResolvedValue(false);
    const { db } = createMockDb();
    await ensureEventTypeForService(ctx(db), { id: 'p1', name: 'Lip Sculpt', active: true });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('does nothing when a row already exists for the product (I3)', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'et-existing' }]);
    await ensureEventTypeForService(ctx(db), { id: 'p1', name: 'Lip Sculpt', active: true });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates the row + resource links from the empty-org fallback template', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing-row check: none
      [], // resolveOrgTemplate: no active rows in the org
      [{ id: 'res-1' }, { id: 'res-2' }], // → fallback: every active resource
      [], // uniqueSlug: no taken slugs
      [{ id: 'et-new' }], // insert event type, returning id
      [], // insert sched_event_type_resources
    ]);
    await ensureEventTypeForService(ctx(db), { id: 'p1', name: 'Lip Sculpt', active: true });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });
});

describe('syncEventTypeFromProduct', () => {
  it('is a no-op when the scheduling module is off', async () => {
    vi.mocked(isModuleEnabled).mockResolvedValue(false);
    const { db } = createMockDb();
    await syncEventTypeFromProduct(ctx(db), {
      id: 'p1',
      name: 'Lip Sculpt',
      active: true,
      kind: 'service',
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('deactivates the row on a service → product kind flip (D5)', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await syncEventTypeFromProduct(ctx(db), {
      id: 'p1',
      name: 'Lip Sculpt',
      active: true,
      kind: 'product',
    });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('renames the row when the product name changed (D5)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'et-1', title: 'Labios Sculpt - Saypha Volume', active: true }]]);
    await syncEventTypeFromProduct(ctx(db), {
      id: 'p1',
      name: 'Lip Sculpt (Saypha Volume)',
      active: true,
      kind: 'service',
    });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('is a no-op resave when title and active already match (D5)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'et-1', title: 'Lip Sculpt', active: true }]]);
    await syncEventTypeFromProduct(ctx(db), {
      id: 'p1',
      name: 'Lip Sculpt',
      active: true,
      kind: 'service',
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates the row via ensure on a product → service kind flip with no existing row (D5)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // syncEventTypeFromProduct's own existing-row check
      [], // ensureEventTypeForService: existing-row check (again)
      [], // resolveOrgTemplate: no active rows
      [{ id: 'res-1' }], // fallback resources
      [], // uniqueSlug
      [{ id: 'et-new' }], // insert event type
      [], // insert resources
    ]);
    await syncEventTypeFromProduct(ctx(db), {
      id: 'p1',
      name: 'Lip Sculpt',
      active: true,
      kind: 'service',
    });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });
});

describe('syncEventTypeForSellable', () => {
  it('derives kind=product from a linked stk_items row, then deactivates (bundle-vs-product derivation)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'p1', name: 'Botox 50U', active: true }], // product lookup
      [{ id: 'item-1' }], // linked stock item found ⇒ kind=product
    ]);
    await syncEventTypeForSellable(ctx(db), 'p1');
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('derives kind=service for a bundle (no linked stk_items row) and renames its row', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'p1', name: 'Dúo MIFILL', active: true }], // product lookup
      [], // no linked stock item ⇒ kind=service (bundle treated as service)
      [{ id: 'et-1', title: 'old title', active: true }], // existing scheduling row
    ]);
    await syncEventTypeForSellable(ctx(db), 'p1');
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the product no longer exists (raced a delete)', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await syncEventTypeForSellable(ctx(db), 'gone');
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
