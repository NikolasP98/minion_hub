import { describe, expect, it } from 'vitest';
import { AccessSessionSelection } from './access-session';

describe('AccessSessionSelection', () => {
  it('preserves a live session when refreshed metadata keeps the same shell id', () => {
    const selection = new AccessSessionSelection();

    expect(selection.select('shell-1')).toBe(true);
    expect(selection.select('shell-1')).toBe(false);
    expect(selection.select('shell-1')).toBe(false);
  });

  it('starts a new session when the selected shell changes', () => {
    const selection = new AccessSessionSelection();

    expect(selection.select('shell-1')).toBe(true);
    expect(selection.select('shell-2')).toBe(true);
    expect(selection.select('shell-2')).toBe(false);
  });
});
