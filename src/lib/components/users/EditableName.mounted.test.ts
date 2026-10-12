// @vitest-environment happy-dom
/**
 * autosave (policy O): the name commits on blur/Enter through Zag's
 * `submitMode: 'both'` and Escape cancels — there is no ✓/✕ trigger pair.
 * shortcut: the Zag editable machine does not transition under happy-dom
 * (edit click / dblclick never enters edit mode), so the commit/revert path
 * is proven in the browser; this test guards the removed triggers only.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import EditableName from './EditableName.svelte';

afterEach(cleanup);

it('renders the edit affordance with no save/cancel triggers', () => {
  render(EditableName, { props: { value: 'Ada', onCommit: vi.fn(async () => true) } });
  expect(screen.getByRole('button', { name: /edit|editar/i })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /save|guardar/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /cancel|cancelar/i })).toBeNull();
  expect(screen.getByText('Ada')).toBeTruthy();
});
