/**
 * HC-011F — the shared booking custom-column store reports WHO landed: `apply`
 * resolves `{ ok, failed }` (never a bare resolve on a refused record), and
 * `writes` builds the per-record move payload against the versions it holds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import { createBookingCustomValues } from './booking-custom-values.svelte';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const def = {
  id: '55555555-5555-4555-8555-555555555555',
  tableId: 'scheduling.bookings',
  label: 'Room',
  type: 'select',
  rules: {
    type: 'select',
    options: [
      { id: 'a', label: 'A', color: null, archivedAt: null },
      { id: 'b', label: 'B', color: null, archivedAt: null },
    ],
  },
  hasDefault: false,
  defaultValue: null,
  archivedAt: null,
  version: 1,
} as unknown as CustomPropertyDefinition;

const cell = (recordId: string, value: string | null, version: number) => ({
  propertyId: def.id,
  recordId,
  present: value !== null,
  value,
  effectiveValue: value,
  version,
  updatedAt: null,
});

describe('createBookingCustomValues', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('apply resolves {ok, failed} with the server code per refused record and re-reads it', async () => {
    const store = createBookingCustomValues();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/tables/properties/values') {
        const body = JSON.parse(init!.body as string) as { recordId: string };
        return body.recordId === 'b2'
          ? jsonResponse({ message: 'version_conflict' }, 409)
          : jsonResponse({ cell: cell(body.recordId, 'b', 1) });
      }
      if (url === '/api/tables/properties/values/query')
        return jsonResponse({
          definitions: [def],
          values: { b2: { [def.id]: cell('b2', 'a', 1) } },
          recordAccess: { b2: { canEdit: true } },
          canManage: false,
          canEdit: true,
        });
      return new Response(null, { status: 404 });
    });

    const outcome = await store.apply(def, ['b1', 'b2'], 'b');

    expect(outcome).toEqual({ ok: ['b1'], failed: [{ id: 'b2', reason: 'version_conflict' }] });
    expect(store.valueOf('b1', def)).toBe('b');
    // The refused record was re-read: it holds the server's value, not the paint.
    expect(store.valueOf('b2', def)).toBe('a');
  });

  it('apply reports a thrown fetch as `network`', async () => {
    const store = createBookingCustomValues();
    fetchMock.mockRejectedValue(new Error('offline'));

    const outcome = await store.apply(def, ['b1'], 'b');

    expect(outcome.ok).toEqual([]);
    expect(outcome.failed).toEqual([{ id: 'b1', reason: 'network' }]);
  });

  it('writes builds one entry per id against the version the store last read (0 when unread)', async () => {
    const store = createBookingCustomValues();
    fetchMock.mockResolvedValue(
      jsonResponse({
        definitions: [def],
        values: { b1: { [def.id]: cell('b1', 'a', 4) } },
        recordAccess: { b1: { canEdit: true } },
        canManage: false,
        canEdit: true,
      }),
    );
    await store.refetch(['b1']);

    expect(store.writes(def, ['b1', 'b9'], 'b')).toEqual([
      { propertyId: def.id, recordId: 'b1', value: 'b', expectedVersion: 4 },
      { propertyId: def.id, recordId: 'b9', value: 'b', expectedVersion: 0 },
    ]);
    expect(store.writes(def, ['b1'], null)[0].value).toBeNull();
  });
});
