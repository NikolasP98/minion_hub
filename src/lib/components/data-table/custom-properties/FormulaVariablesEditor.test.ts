// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));

const { default: Fixture } = await import('./FormulaVariablesEditor.fixture.svelte');

afterEach(cleanup);

describe('FormulaVariablesEditor', () => {
  it('adds named variables, preserves the primary id, and reorders through keyboard controls', async () => {
    const { container } = render(Fixture);

    await fireEvent.click(screen.getByRole('button', { name: /Add variable|Agregar variable/i }));

    const names = Array.from(container.querySelectorAll('input[maxlength="40"]'));
    expect(names).toHaveLength(2);
    expect((names[0] as HTMLInputElement).value).toMatch(/Variable 1/i);
    expect((names[1] as HTMLInputElement).value).toMatch(/Variable 2/i);
    expect(screen.getByLabelText('primary variable').textContent).toBe(
      '10000000-0000-4000-8000-000000000001',
    );

    await fireEvent.click(screen.getAllByRole('button', { name: /Move earlier|Mover antes/i })[1]);
    expect(screen.getByLabelText('variable order').textContent?.split(',')[1]).toBe(
      '10000000-0000-4000-8000-000000000001',
    );
    expect(screen.getByLabelText('announcement').textContent).toMatch(/1.*2/);
  });

  it('disables every mutation control while the formula is restricted', () => {
    render(Fixture, { props: { disabled: true } });

    expect(
      (screen.getByRole('button', { name: /Add variable|Agregar variable/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it('requires a new primary before removal and normalizes the surviving singleton', async () => {
    render(Fixture);
    await fireEvent.click(screen.getByRole('button', { name: /Add variable|Agregar variable/i }));
    const ids = screen.getByLabelText('variable order').textContent!.split(',');
    const removeButtons = screen.getAllByRole('button', {
      name: /Remove variable|Eliminar variable/i,
    });
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.change(
      screen.getByLabelText(/Value used for sorting|Valor usado para ordenar/i),
      { target: { value: ids[1] } },
    );
    expect(screen.getByLabelText('primary variable').textContent).toBe(ids[1]);
    expect((removeButtons[1] as HTMLButtonElement).disabled).toBe(true);
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(false);

    await fireEvent.click(removeButtons[0]);
    expect(screen.getByLabelText('variable order').textContent).toBe(ids[1]);
    expect(screen.getByLabelText('variable names').textContent).toBe('[null]');
  });
});
