// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import Fixture from './OptimisticOwner.fixture.svelte';
afterEach(cleanup);
it('retires an overlay inside a derived value without mutating reactive state during render', async () => {
  const view = render(Fixture);
  await tick();
  await fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  await tick();
  expect(view.container.querySelector('output')?.textContent).toBe('true');
  await fireEvent.click(view.getByRole('button', { name: 'Switch owner' }));
  await tick();
  expect(view.container.querySelector('output')?.textContent).toBe('false');
  await fireEvent.click(view.getByRole('button', { name: 'Finish old write' }));
  await tick();
  expect(view.container.querySelector('output')?.textContent).toBe('false');
});
