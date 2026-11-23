import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { blockDetail, statusIcon, STATUS_ICONS } from './block-label';
import { Circle } from 'lucide-svelte';
import { BOOKING_STATUSES } from './booking-status';

describe('blockDetail', () => {
  const parts = { day: 'Tuesday, September 8', start: '10:00', end: '10:45', status: 'Confirmed' };
  it('gives the day, the full range and the status', () => {
    expect(blockDetail(parts)).toBe('Tuesday, September 8, 10:00 to 10:45, Confirmed');
  });
  it('passes every status through', () => {
    for (const status of ['Confirmed', 'Pending', 'Completed', 'Rejected', 'No-show', 'Cancelled'])
      expect(blockDetail({ ...parts, status }).endsWith(`, ${status}`)).toBe(true);
  });
  it('has Spanish wording with the same placeholders', () => {
    const es = JSON.parse(readFileSync('messages/es.json', 'utf8'));
    expect(es.sched_block_detail).toBe('{day}, {start} a {end}, {status}');
    expect(es.sched_range_announce_other).toContain('{count}');
  });
});

describe('statusIcon', () => {
  it('maps the six ids and falls back to Circle', () => {
    expect(Object.keys(STATUS_ICONS).sort()).toEqual([...BOOKING_STATUSES].sort());
    for (const id of BOOKING_STATUSES) expect(statusIcon(id)).not.toBe(Circle);
    expect(statusIcon('weird')).toBe(Circle);
  });
});
