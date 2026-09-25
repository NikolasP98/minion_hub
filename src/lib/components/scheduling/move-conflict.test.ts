import { describe, expect, it } from 'vitest';
import { conflictLine, type MoveConflict } from './move-conflict';

const CONFLICT: MoveConflict = {
  id: 'b1',
  title: 'Botox entrecejo',
  start: '2026-09-25T20:30:00.000Z',
  end: '2026-09-25T20:45:00.000Z',
  resourceId: 'r1',
};

/** Stand-in for the grid's locale-pinned `formatTime`. */
const hhmm = (iso: string) => iso.slice(11, 16);

describe('conflictLine', () => {
  it('reads service · client · range (staff)', () => {
    expect(
      conflictLine(CONFLICT, { hhmm, service: 'Botox', client: 'Ana Pérez', staff: 'Dra. Luz' }),
    ).toBe('Botox · Ana Pérez · 20:30–20:45 (Dra. Luz)');
  });

  it('falls back to the server title and drops the parts it has no data for', () => {
    expect(conflictLine(CONFLICT, { hhmm })).toBe('Botox entrecejo · 20:30–20:45');
  });

  it('shows only the range when the clash has no title either', () => {
    expect(conflictLine({ ...CONFLICT, title: null }, { hhmm })).toBe('20:30–20:45');
    expect(conflictLine({ ...CONFLICT, title: '  ' }, { hhmm })).toBe('20:30–20:45');
  });

  it('never leaks a raw ISO instant — every time goes through the formatter', () => {
    const line = conflictLine(CONFLICT, { hhmm, client: 'Ana' });
    expect(line).not.toContain('T20:30');
    expect(line).not.toContain('Z');
  });
});
