// @vitest-environment happy-dom
/** Spec 147 — the "Cerrar agenda" form posts one range and says when the role can't. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import AgendaClosureForm from './AgendaClosureForm.svelte';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(status: number) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ groupId: 'g', count: 3 }), { status }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const onclosed = vi.fn();
  render(AgendaClosureForm, {
    initialDate: '2026-11-24',
    initialTime: '09:00',
    onclosed,
    oncancel: vi.fn(),
  });
  return { fetchMock, onclosed };
}

async function fillAndSubmit() {
  const reason = screen.getByLabelText(/Reason/) as HTMLInputElement;
  await fireEvent.input(reason, { target: { value: 'Viaje del doctor' } });
  const submit = screen.getAllByRole('button', { name: 'Close agenda' }).at(-1)!;
  await fireEvent.click(submit);
}

describe('AgendaClosureForm', () => {
  it('posts the day range, the window and the reason, then reports closed', async () => {
    const { fetchMock, onclosed } = mount(201);
    await fillAndSubmit();
    await vi.waitFor(() => expect(onclosed).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/scheduling/closures');
    expect(JSON.parse(String(init.body))).toEqual({
      fromDate: '2026-11-24',
      toDate: '2026-11-24',
      startTime: '09:00',
      endTime: '20:00',
      reason: 'Viaje del doctor',
    });
  });

  it('a 403 says the role cannot close the agenda', async () => {
    const { onclosed } = mount(403);
    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Your role cannot close the agenda',
    );
    expect(onclosed).not.toHaveBeenCalled();
  });

  it('cannot submit without a reason', () => {
    mount(201);
    const submit = screen.getAllByRole('button', { name: 'Close agenda' }).at(-1)!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});
