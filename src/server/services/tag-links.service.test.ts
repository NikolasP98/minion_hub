import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { getTagLinks, setTagLinks, getContactTagsBulk } from './tag-links.service';

// Mirrors scheduling-bookings-override.test.ts's mock style.
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('tag-links.service', () => {
  describe('getTagLinks', () => {
    it('returns an empty map without touching the db when ids is empty', async () => {
      const { db } = createMockDb();
      const map = await getTagLinks(ctx(db), 'booking', []);
      expect(map.size).toBe(0);
    });

    it('groups tag rows by entityId', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          { entityId: 'b-1', id: 't-1', name: 'VIP', color: '#fff' },
          { entityId: 'b-1', id: 't-2', name: 'Follow-up', color: '#000' },
          { entityId: 'b-2', id: 't-1', name: 'VIP', color: '#fff' },
        ],
      ]);
      const map = await getTagLinks(ctx(db), 'booking', ['b-1', 'b-2']);
      expect(map.get('b-1')).toEqual([
        { id: 't-1', name: 'VIP', color: '#fff' },
        { id: 't-2', name: 'Follow-up', color: '#000' },
      ]);
      expect(map.get('b-2')).toEqual([{ id: 't-1', name: 'VIP', color: '#fff' }]);
    });

    it('preserves the query result order (position then name) within a group', async () => {
      // The mock returns rows verbatim (no client-side re-sort) — ordering is
      // owned by the query's `.orderBy(crmTags.position, crmTags.name)`; this
      // asserts the service doesn't reorder what the DB already sorted.
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          { entityId: 'b-1', id: 't-2', name: 'Alpha', color: '#111' }, // position 0
          { entityId: 'b-1', id: 't-1', name: 'Zulu', color: '#222' }, // position 1
          { entityId: 'b-1', id: 't-3', name: 'Beta', color: '#333' }, // position 1, name tiebreak
        ],
      ]);
      const map = await getTagLinks(ctx(db), 'booking', ['b-1']);
      expect(map.get('b-1')?.map((t) => t.id)).toEqual(['t-2', 't-1', 't-3']);
    });
  });

  describe('setTagLinks', () => {
    it('rejects a tag id that does not resolve for this org', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [{ id: 't-1', name: 'VIP', color: '#fff' }], // validate: only 1 of the 2 requested ids resolved
      ]);
      await expect(
        setTagLinks(ctx(db), 'booking', 'b-1', ['t-1', 't-missing'], null),
      ).rejects.toThrow('invalid');
    });

    it('replaces the tag set and returns it', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [{ id: 't-1', name: 'VIP', color: '#fff' }], // validate tagIds
        [], // delete
        [], // insert
      ]);
      const tags = await setTagLinks(ctx(db), 'booking', 'b-1', ['t-1'], 'user-1');
      expect(tags).toEqual([{ id: 't-1', name: 'VIP', color: '#fff' }]);
    });

    it('clears all tags when tagIds is empty (delete only, no validation query)', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([[]]); // delete
      const tags = await setTagLinks(ctx(db), 'event_type', 'et-1', [], null);
      expect(tags).toEqual([]);
    });
  });

  describe('getContactTagsBulk', () => {
    it('returns an empty map without touching the db when contactIds is empty', async () => {
      const { db } = createMockDb();
      const map = await getContactTagsBulk(ctx(db), []);
      expect(map.size).toBe(0);
    });

    it('groups contact tag rows by contactId', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([[{ contactId: 'c-1', id: 't-1', name: 'Loyal', color: '#0f0' }]]);
      const map = await getContactTagsBulk(ctx(db), ['c-1']);
      expect(map.get('c-1')).toEqual([{ id: 't-1', name: 'Loyal', color: '#0f0' }]);
    });

    it('preserves the query result order (position then name) within a group', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          { contactId: 'c-1', id: 't-2', name: 'Alpha', color: '#111' },
          { contactId: 'c-1', id: 't-1', name: 'Zulu', color: '#222' },
        ],
      ]);
      const map = await getContactTagsBulk(ctx(db), ['c-1']);
      expect(map.get('c-1')?.map((t) => t.id)).toEqual(['t-2', 't-1']);
    });
  });
});
