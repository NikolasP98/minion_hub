// @vitest-environment happy-dom
/**
 * Spec 146 (a11y program S1) — the session task board runs on the shared BoardView:
 * a task moves from its "Move to…" menu with the keyboard alone, with ONE save, an
 * announcement and focus that stays on the card; a refused save puts the card back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import SessionKanban from './SessionKanban.svelte';
import { sessionTasksState, type SessionTaskData } from '$lib/state/features/session-tasks.svelte';
import { assertPattern } from '$lib/a11y/assert-pattern';

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('$lib/state/ui/toast.svelte', async (orig) => ({
  ...(await orig<object>()),
  toastError: (...a: unknown[]) => toast.error(...a),
}));

const task = (id: string, title: string, status: SessionTaskData['status']): SessionTaskData => ({
  id,
  tenantId: 't',
  serverId: 'srv',
  sessionKey: 'sess',
  title,
  description: id === 't1' ? 'twelve without an answer' : null,
  status,
  sortOrder: 0,
  metadata: null,
  createdAt: 0,
  updatedAt: 0,
});
const seed = () => [
  task('t1', 'Confirm bookings', 'todo'),
  task('t2', 'Send price list', 'todo'),
  task('t3', 'Register payment', 'done'),
];

let patches: { url: string; body: unknown }[] = [];
let patchOk = true;

beforeEach(() => {
  patches = [];
  patchOk = true;
  const tasks = seed();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push({ url, body: JSON.parse(String(init.body)) });
        return { ok: patchOk, status: patchOk ? 200 : 500, json: async () => ({}) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ tasks }) } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  toast.error.mockClear();
  vi.unstubAllGlobals();
  delete sessionTasksState.tasksBySession.sess;
});

/** Zag schedules focus/highlight through rAF + microtasks; let them land. */
async function settle() {
  await tick();
  await new Promise((r) => setTimeout(r, 40));
  await tick();
}
const menuEl = () => document.querySelector<HTMLElement>('[role="menu"]:not([hidden])');
const highlighted = () => {
  const id = menuEl()?.getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};

async function mount() {
  const view = render(SessionKanban, { props: { sessionKey: 'sess', serverId: 'srv' } });
  await settle();
  // The panel remembers "collapsed" by default; open it.
  const header = view.container.querySelector<HTMLElement>(
    '[aria-controls="session-kanban-panel"]',
  )!;
  if (header.getAttribute('aria-expanded') !== 'true') await fireEvent.click(header);
  await settle();
  const wrap = (id: string) => view.container.querySelector<HTMLElement>(`[data-row-key="${id}"]`)!;
  const trigger = (id: string) =>
    wrap(id).querySelector<HTMLElement>('[data-scope="menu"][data-part="trigger"]')!;
  const column = (id: string) => wrap(id).closest('section')!.getAttribute('aria-label');
  const live = () => view.container.querySelector<HTMLElement>('[aria-live="polite"]')!;
  return { view, wrap, trigger, column, live };
}

async function openAndWalkTo(trigger: HTMLElement, label: string) {
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  await settle();
  expect(menuEl()).not.toBeNull();
  for (let i = 0; i < 8 && highlighted()?.textContent?.trim() !== label; i++) {
    await fireEvent.keyDown(menuEl()!, { key: 'ArrowDown' });
    await settle();
  }
  expect(highlighted()?.textContent?.trim()).toBe(label);
}

describe('SessionKanban on BoardView (spec 146)', () => {
  it('shows the four status columns, sharing the width, with plain (non-button) cards', async () => {
    const { view, wrap } = await mount();
    const columns = [...view.container.querySelectorAll('section.bcol')].map((s) =>
      s.getAttribute('aria-label'),
    );
    expect(columns).toEqual(['Backlog', 'Todo', 'In Progress', 'Done']);
    expect(view.container.querySelector('.board')?.classList.contains('is-fit')).toBe(true);
    // A task has nothing to open: its card is not a button; the move trigger is the control.
    expect(wrap('t1').querySelector('button.bcard')).toBeNull();
    expect(wrap('t1').querySelector('.bcard')?.textContent).toContain('Confirm bookings');
    expect(wrap('t1').querySelector('.bcard')?.textContent).toContain('twelve without an answer');
  });

  it('moves a task with the keyboard: one save, announced, focus stays on the card', async () => {
    const { trigger, column, live } = await mount();
    expect(column('t1')).toBe('Todo');
    await openAndWalkTo(trigger('t1'), 'In Progress');
    // The current column is listed but disabled; there is no "unset" target.
    const items = [...menuEl()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((el) => el.textContent?.trim())).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'Done',
    ]);
    expect(items[1].getAttribute('aria-disabled')).toBe('true');

    await fireEvent.keyDown(menuEl()!, { key: 'Enter' });
    await settle();
    await settle();

    expect(patches).toEqual([
      { url: '/api/servers/srv/sessions/sess/tasks/t1', body: { status: 'in_progress' } },
    ]);
    expect(column('t1')).toBe('In Progress');
    expect(live().textContent).toBe('Confirm bookings moved to In Progress');
    expect(document.activeElement).toBe(trigger('t1'));
  });

  it('puts the card back and says so when the save is refused', async () => {
    patchOk = false;
    const { trigger, column, live } = await mount();
    await openAndWalkTo(trigger('t3'), 'Backlog');
    await fireEvent.keyDown(menuEl()!, { key: 'Enter' });
    await settle();
    await settle();
    expect(patches).toHaveLength(1);
    expect(column('t3')).toBe('Done');
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(live().textContent).toBe('Could not move Register payment');
  });

  it('still moves by mouse drag with the same single save', async () => {
    const { view, wrap, column } = await mount();
    const done = [...view.container.querySelectorAll<HTMLElement>('section.bcol')].find(
      (s) => s.getAttribute('aria-label') === 'Done',
    )!;
    await fireEvent.dragStart(wrap('t2'));
    await fireEvent.dragOver(done);
    await fireEvent.drop(done);
    await settle();
    expect(patches).toEqual([
      { url: '/api/servers/srv/sessions/sess/tasks/t2', body: { status: 'done' } },
    ]);
    expect(column('t2')).toBe('Done');
  });

  it('the "Move to…" menu follows the WAI-ARIA menu pattern', async () => {
    const { trigger } = await mount();
    const opener = trigger('t1');
    opener.focus();
    await fireEvent.keyDown(opener, { key: 'Enter' });
    await settle();
    await assertPattern(menuEl()!, 'menu', { opener });
  });

  it('keeps the existing text for a session without tasks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tasks: [] }) }) as Response),
    );
    const { view } = await mount();
    expect(view.container.querySelector('.board')).toBeNull();
    expect(view.container.textContent).toContain('No tasks for this session.');
  });
});
