// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { Button } from '@minion-stack/ui';

afterEach(cleanup);

it.each([
  'switch',
  'menuitem',
  'option',
  'radio',
  'checkbox',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
] as const)('preserves reactive %s semantics and caller state', async (role) => {
  const onclick = vi.fn();
  const view = render(Button, {
    role,
    tabindex: -1,
    'aria-label': 'Choice',
    'aria-checked': false,
    onclick,
  });
  const control = view.getByRole(role, { name: 'Choice' });
  expect(control.getAttribute('tabindex')).toBe('-1');
  expect(control.getAttribute('aria-checked')).toBe('false');
  await view.rerender({ tabindex: 0, 'aria-checked': true });
  expect(control.getAttribute('tabindex')).toBe('0');
  expect(control.getAttribute('aria-checked')).toBe('true');
  await fireEvent.click(control);
  expect(onclick).toHaveBeenCalledTimes(1);
  const nextRole = role === 'switch' ? 'radio' : 'switch';
  await view.rerender({ role: nextRole });
  expect(view.queryByRole(role, { name: 'Choice' })).toBeNull();
  expect(view.getByRole(nextRole, { name: 'Choice' })).toBe(control);
});

it.each([undefined, '/#synthetic-link'])(
  'blocks disabled/loading activation and recovers, href=%s',
  async (href) => {
    const onclick = vi.fn();
    const bubble = vi.fn();
    const submit = vi.fn((event: Event) => event.preventDefault());
    const form = document.createElement('form');
    form.addEventListener('click', bubble);
    form.addEventListener('submit', submit);
    document.body.append(form);
    // Mount into a normal application root within the form. happy-dom's form
    // direct delegation root produced duplicate callbacks in the retained
    // diagnostic; the native fixture separately qualifies real form behavior.
    const root = document.createElement('div');
    form.append(root);
    const view = render(Button, {
      target: root,
      props: { href, role: 'switch', tabindex: 0, 'aria-label': 'Choice', onclick },
    });
    let control = view.getByRole('switch', { name: 'Choice' });
    await fireEvent.click(control);
    expect(onclick).toHaveBeenCalledTimes(1);
    expect(bubble).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    for (const state of [
      { disabled: true, loading: false },
      { disabled: false, loading: true },
    ]) {
      await view.rerender(state);
      control = view.getByRole('switch', { name: 'Choice' });
      if (href) {
        expect(control.hasAttribute('href')).toBe(false);
        expect(control.getAttribute('tabindex')).toBe('-1');
        expect(control.getAttribute('aria-disabled')).toBe('true');
      } else expect((control as HTMLButtonElement).disabled).toBe(true);
      expect(control.getAttribute('aria-busy')).toBe(state.loading ? 'true' : null);
      // Dispatch even on disabled controls: the handler must independently block
      // synthetic activation as well as the browser's native disabled behavior.
      await fireEvent.click(control);
      expect(onclick).toHaveBeenCalledTimes(1);
      expect(bubble).toHaveBeenCalledTimes(1);
      expect(submit).not.toHaveBeenCalled();
    }
    await view.rerender({ disabled: false, loading: false });
    control = view.getByRole('switch', { name: 'Choice' });
    expect(control.getAttribute('tabindex')).toBe('0');
    expect(control.getAttribute('aria-busy')).toBeNull();
    if (href) expect(control.getAttribute('href')).toBe(href);
    await fireEvent.click(control);
    expect(onclick).toHaveBeenCalledTimes(2);
    expect(bubble).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
    form.remove();
  },
);

it('keeps native default type and explicit submit/reset form actions', async () => {
  const form = document.createElement('form');
  document.body.append(form);
  const submit = vi.fn((event: Event) => event.preventDefault());
  const reset = vi.fn();
  form.addEventListener('submit', submit);
  form.addEventListener('reset', reset);
  // Mount into a normal application root within the form. happy-dom's form
  // direct delegation root produced duplicate callbacks in the retained
  // diagnostic; the native fixture separately qualifies real form behavior.
  const root = document.createElement('div');
  form.append(root);
  const view = render(Button, { target: root, props: { 'aria-label': 'Action' } });
  const control = view.getByRole('button', { name: 'Action' }) as HTMLButtonElement;
  expect(control.type).toBe('button');
  control.click();
  expect(submit).not.toHaveBeenCalled();
  await view.rerender({ type: 'submit', disabled: true });
  control.click();
  expect(submit).not.toHaveBeenCalled();
  await view.rerender({ disabled: false, loading: true });
  control.click();
  expect(submit).not.toHaveBeenCalled();
  await view.rerender({ loading: false });
  control.click();
  expect(submit).toHaveBeenCalledTimes(1);
  await view.rerender({ type: 'reset' });
  control.click();
  expect(reset).toHaveBeenCalledTimes(1);
  form.remove();
});
