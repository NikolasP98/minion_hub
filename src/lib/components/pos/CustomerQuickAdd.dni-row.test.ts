// @vitest-environment happy-dom
//
// Regression for the 2026-09-30 owner recording: typing a full DNI in the
// POS "Nuevo cliente" form made the document-number input collapse to a few
// pixels. The autofill button rendered its full text label inside the same
// ~150px grid cell as the input; the input (flex:1; min-width:0) gave way and
// the button kept its intrinsic width. The button is now icon-only with the
// label carried by aria-label + tooltip, so the cell never hosts more than
// the input plus one square control.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: CustomerQuickAdd } = await import('./CustomerQuickAdd.svelte');

afterEach(() => cleanup());

describe('CustomerQuickAdd DNI autofill affordance', () => {
  it('shows an icon-only button (no text label) once a full DNI is typed', async () => {
    render(CustomerQuickAdd, {
      props: { initialQuery: '', oncreated: () => {}, oncancel: () => {} },
    });
    const label = m.pos_customer_quick_dni_autofill();
    expect(screen.queryByRole('button', { name: label })).toBeNull();

    const input = screen.getByLabelText(m.party_picker_document_number()) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '60525678' } });

    const btn = screen.getByRole('button', { name: label });
    expect(btn.textContent?.trim()).toBe('');
    expect(btn.classList.contains('dni-autofill')).toBe(true);
  });
});
