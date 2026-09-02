import { describe, expect, it } from 'vitest';
import { buildServiceRows } from './service-rows';

describe('buildServiceRows', () => {
  it('flags configured services, keeps dormant + unlinked event types, orders configured first', () => {
    const services = [
      { id: 'p-botox', name: 'Botox' },
      { id: 'p-facial', name: 'Facial' },
      { id: 'p-aaa', name: 'AAA dormant' },
    ];
    const eventTypes = [
      { id: 'e1', title: 'Facial 60', productId: 'p-facial' },
      { id: 'e2', title: 'Legacy consult', productId: null },
      { id: 'e3', title: 'Orphan', productId: 'p-deleted' },
    ];
    const rows = buildServiceRows(services, eventTypes);
    expect(rows.map((r) => [r.title, !!r.service, r.eventType?.id ?? null])).toEqual([
      ['Facial', true, 'e1'],
      ['Legacy consult', false, 'e2'],
      ['Orphan', false, 'e3'],
      ['AAA dormant', true, null],
      ['Botox', true, null],
    ]);
  });
});
