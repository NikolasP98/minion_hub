// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import ErrorSummary from './ErrorSummary.svelte';
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});
it('keeps linked errors keyboard accessible and focuses the actual field', async () => {
  const input = document.createElement('input');
  input.id = 'name';
  document.body.append(input);
  const view = render(ErrorSummary, {
    props: { title: 'Check the form', errors: [{ id: 'name', message: 'Enter a name' }] },
  });
  const link = view.getByRole('link', { name: 'Enter a name' });
  expect(link.getAttribute('href')).toBe('#name');
  await fireEvent.click(link);
  expect(document.activeElement).toBe(input);
  expect(view.getByRole('alert')).toBeTruthy();
});
