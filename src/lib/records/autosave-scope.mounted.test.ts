// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import AutosaveScope from '../../../tests/fixtures/personal-navigation/AutosaveScope.svelte';
afterEach(cleanup);

describe('autosave with the real app action provider', () => {
  it('survives late root scope initialization and immediately projects a write through derived state', async () => {
    const write = vi.fn(async () => {});
    const view = render(AutosaveScope, { write });
    await tick();
    expect(view.getByTestId('value').textContent).toBe('server-a');
    await fireEvent.input(view.getByLabelText('Value'), { target: { value: 'edited' } });
    await tick();
    expect(view.getByTestId('value').textContent).toBe('edited');
    await waitFor(() => expect(view.getByTestId('status').textContent).toBe('saved'));
    expect(write).toHaveBeenCalledExactlyOnceWith('edited');
  });
  it('keeps an unknown draft visible after generation adoption instead of silently losing it', async () => {
    const write = vi.fn(async () => {
      throw new TypeError('lost response');
    });
    const view = render(AutosaveScope, { write });
    await tick();
    await fireEvent.input(view.getByLabelText('Value'), { target: { value: 'attempted' } });
    await waitFor(() => expect(view.getByTestId('status').textContent).toBe('unknown'));
    expect(view.getByTestId('value').textContent).toBe('attempted');
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('reads a replacement owner without mutating state inside its derived render', async () => {
    const write = vi.fn(async () => {});
    const view = render(AutosaveScope, { write });
    await tick();
    await view.rerender({ scope: 'actor-b', committed: 'server-b', write });
    await tick();
    expect(view.getByTestId('value').textContent).toBe('server-b');
    expect(view.getByTestId('status').textContent).toBe('idle');
    expect(write).not.toHaveBeenCalled();
    await fireEvent.input(view.getByLabelText('Value'), { target: { value: 'edited-b' } });
    await waitFor(() => expect(view.getByTestId('status').textContent).toBe('saved'));
    expect(view.getByTestId('value').textContent).toBe('edited-b');
    expect(write).toHaveBeenCalledExactlyOnceWith('edited-b');
  });
});
