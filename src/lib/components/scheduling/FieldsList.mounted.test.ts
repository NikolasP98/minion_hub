// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import FieldsList from './FieldsList.svelte';
afterEach(cleanup);
describe('FieldsList keyboard alternatives', () => {
  it('offers explicit movement and respects locked neighbor slots', async () => {
    const onmove = vi.fn();
    const r = render(FieldsList, {
      heading: 'Fields',
      fields: [
        { key: 'a', label: 'Alpha' },
        { key: 'b', label: 'Beta' },
        { key: 'c', label: 'Fixed' },
      ],
      order: ['a', 'b', 'c'],
      hidden: new Set<string>(),
      ontoggle: vi.fn(),
      onmove,
      lockedKeys: ['c'],
    });
    await fireEvent.click(r.getByRole('button', { name: 'Move Beta earlier' }));
    expect(onmove).toHaveBeenCalledWith('b', 'a');
    expect(r.getByRole('button', { name: 'Move Beta later' }).hasAttribute('disabled')).toBe(true);
    expect(r.queryByRole('button', { name: 'Move Fixed earlier' })).toBeNull();
  });
  it('disables dependent choices while their parent is hidden', async () => {
    const ontoggle = vi.fn();
    const r = render(FieldsList, {
      heading: '',
      fields: [{ key: 'a', label: 'Parent', children: [{ key: 'sub', label: 'Child' }] }],
      order: ['a'],
      hidden: new Set(['a']),
      ontoggle,
      onmove: vi.fn(),
    });
    const child = r.getByRole('button', { name: 'Child' });
    expect(child.hasAttribute('disabled')).toBe(true);
    expect(child.getAttribute('title')).toBeTruthy();
    await fireEvent.click(child);
    expect(ontoggle).not.toHaveBeenCalled();
  });
});
