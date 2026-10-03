// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type {
  NotificationHealthSeed,
  NotificationWorkerHealth,
} from '$lib/notifications/worker-health';
import Page from './+page.svelte';

function health(
  checkedAt: string,
  state: NotificationWorkerHealth['state'] = 'runnable',
  pending = 7,
): NotificationWorkerHealth {
  return {
    checkedAt,
    state,
    worker: {
      heartbeat: { ageMs: 100, futureTimestamp: false },
      identity: {
        buildSha: 'a'.repeat(40),
        catalogRevision: 'catalog.v1',
        catalogSha256: 'b'.repeat(64),
        projectorRevision: 'projector.v1',
        projectorSha256: 'c'.repeat(64),
      },
      admission: null,
    },
    organization: {
      lastCompleted: { ageMs: 200, futureTimestamp: false },
      lastSuccess: { ageMs: 200, futureTimestamp: false },
      failureStreak: 0,
      lastFailureCode: null,
      lastResult: 'completed',
    },
    queue: {
      pending: {
        count: pending,
        lowerBound: pending === 5000,
        oldest: { ageMs: 60_000, futureTimestamp: false },
      },
      processing: {
        count: 0,
        lowerBound: false,
        oldest: { ageMs: null, futureTimestamp: false },
      },
      unsupportedCatalogPending: false,
    },
  };
}

function pageData(
  actorId: string,
  orgId: string,
  healthSeed: NotificationHealthSeed,
): Record<string, unknown> {
  return {
    user: { id: actorId, supabaseId: actorId },
    activeOrgId: orgId,
    healthSeed,
    tables: [{ table: 'support_issues', dateFields: [] }],
    rules: [
      {
        id: 'rule-1',
        name: 'Urgent ticket',
        enabled: true,
        triggerTable: 'support_issues',
        triggerEvent: 'insert',
        dateField: null,
        dateOffsetMins: null,
        channel: 'email',
        accountId: null,
        condition: [],
        recipients: [],
        template: 'Notice',
      },
    ],
  };
}

function response(value: NotificationWorkerHealth): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function installScrollIntoView() {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const mock = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: mock,
  });
  return {
    mock,
    restore() {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('notification settings worker health', () => {
  it.each([
    { reducedMotion: false, behavior: 'smooth' as const },
    { reducedMotion: true, behavior: 'auto' as const },
  ])(
    'reveals and focuses the rule editor, then returns focus to its row (reduced motion: $reducedMotion)',
    async ({ reducedMotion, behavior }) => {
      const scroll = installScrollIntoView();
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: reducedMotion })),
      );

      try {
        const view = render(Page, {
          data: pageData('actor-a', 'org-a', {
            actorId: 'actor-a',
            orgId: 'org-a',
            status: 'ready',
            value: health('2026-10-03T12:00:00.000Z'),
          }),
        } as never);
        const edit = view.getByRole('button', { name: 'Edit' });

        await fireEvent.click(edit);
        const name = view.getByLabelText('Name');
        await waitFor(() => expect(document.activeElement).toBe(name));
        expect((name as HTMLInputElement).value).toBe('Urgent ticket');
        expect(scroll.mock).toHaveBeenCalledWith({ behavior, block: 'start' });

        await fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(document.activeElement).toBe(edit));
        expect(scroll.mock).toHaveBeenCalledWith({ behavior, block: 'center' });
      } finally {
        scroll.restore();
      }
    },
  );

  it('drops the old organization edit draft and focus owner before rendering the new organization', async () => {
    const scroll = installScrollIntoView();
    try {
      const view = render(Page, {
        data: pageData('actor-a', 'org-a', {
          actorId: 'actor-a',
          orgId: 'org-a',
          status: 'ready',
          value: health('2026-10-03T12:00:00.000Z'),
        }),
      } as never);
      await fireEvent.click(view.getByRole('button', { name: 'Edit' }));
      const name = view.getByLabelText('Name');
      await waitFor(() => expect(document.activeElement).toBe(name));

      await view.rerender({
        data: pageData('actor-b', 'org-b', {
          actorId: 'actor-b',
          orgId: 'org-b',
          status: 'ready',
          value: health('2026-10-03T12:01:00.000Z'),
        }),
      } as never);

      await waitFor(() => expect((view.getByLabelText('Name') as HTMLInputElement).value).toBe(''));
      expect(view.getByRole('heading', { name: 'New rule' })).toBeTruthy();
      expect(view.queryByRole('button', { name: 'Cancel' })).toBeNull();
      expect(document.activeElement).not.toBe(name);
    } finally {
      scroll.restore();
    }
  });

  it('drops reveal and cancel focus continuations when the owner changes in the same tick', async () => {
    const scroll = installScrollIntoView();
    try {
      const view = render(Page, {
        data: pageData('actor-a', 'org-a', {
          actorId: 'actor-a',
          orgId: 'org-a',
          status: 'ready',
          value: health('2026-10-03T12:00:00.000Z'),
        }),
      } as never);

      const oldEdit = view.getByRole('button', { name: 'Edit' }) as HTMLButtonElement;
      oldEdit.click();
      await view.rerender({
        data: pageData('actor-b', 'org-b', {
          actorId: 'actor-b',
          orgId: 'org-b',
          status: 'ready',
          value: health('2026-10-03T12:01:00.000Z'),
        }),
      } as never);
      await Promise.resolve();

      expect(scroll.mock).not.toHaveBeenCalled();
      expect((view.getByLabelText('Name') as HTMLInputElement).value).toBe('');
      expect(document.activeElement).not.toBe(view.getByLabelText('Name'));

      const currentEdit = view.getByRole('button', { name: 'Edit' }) as HTMLButtonElement;
      await fireEvent.click(currentEdit);
      await waitFor(() => expect(document.activeElement).toBe(view.getByLabelText('Name')));
      scroll.mock.mockClear();

      const cancel = view.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
      cancel.click();
      await view.rerender({
        data: pageData('actor-c', 'org-c', {
          actorId: 'actor-c',
          orgId: 'org-c',
          status: 'ready',
          value: health('2026-10-03T12:02:00.000Z'),
        }),
      } as never);
      await Promise.resolve();

      expect(scroll.mock).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(currentEdit);
      expect((view.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    } finally {
      scroll.restore();
    }
  });

  it('fails closed when the canonical profile identity is absent', async () => {
    const read = vi.fn();
    vi.stubGlobal('fetch', read);
    const data = pageData('actor-a', 'org-a', {
      actorId: 'actor-a',
      orgId: 'org-a',
      status: 'ready',
      value: health('2026-10-03T12:00:00.000Z'),
    });
    delete (data.user as { supabaseId?: string }).supabaseId;

    const view = render(Page, { data } as never);
    expect(view.getByText(/session identity is unavailable/i)).toBeTruthy();
    expect((view.getByRole('button', { name: 'Create rule' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((view.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'save' as const, outcome: 'success' as const },
    { kind: 'save' as const, outcome: 'error' as const },
    { kind: 'delete' as const, outcome: 'success' as const },
    { kind: 'delete' as const, outcome: 'error' as const },
  ])(
    'keeps the new owner draft independent of a delayed old-owner $kind $outcome continuation',
    async ({ kind, outcome }) => {
      const scroll = installScrollIntoView();
      const request = deferred<Response>();
      vi.stubGlobal(
        'fetch',
        vi.fn(() => request.promise),
      );
      try {
        const view = render(Page, {
          data: pageData('actor-a', 'org-a', {
            actorId: 'actor-a',
            orgId: 'org-a',
            status: 'ready',
            value: health('2026-10-03T12:00:00.000Z'),
          }),
        } as never);
        if (kind === 'save') {
          await fireEvent.click(view.getByRole('button', { name: 'Edit' }));
          await fireEvent.click(view.getByRole('button', { name: 'Update rule' }));
        } else {
          await fireEvent.click(view.getByRole('button', { name: 'Delete' }));
        }

        await view.rerender({
          data: pageData('actor-b', 'org-b', {
            actorId: 'actor-b',
            orgId: 'org-b',
            status: 'ready',
            value: health('2026-10-03T12:01:00.000Z'),
          }),
        } as never);
        const name = view.getByLabelText('Name') as HTMLInputElement;
        const template = view.getByLabelText(/Template/) as HTMLTextAreaElement;
        await fireEvent.input(name, { target: { value: 'Workspace B draft' } });
        await fireEvent.input(template, { target: { value: 'Workspace B template' } });
        const create = view.getByRole('button', { name: 'Create rule' }) as HTMLButtonElement;
        expect(create.disabled).toBe(false);

        if (outcome === 'success') request.resolve(new Response('{}', { status: 200 }));
        else request.reject(new Error('old workspace failure'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(name.value).toBe('Workspace B draft');
        expect(template.value).toBe('Workspace B template');
        expect(create.disabled).toBe(false);
        expect(view.queryByText('old workspace failure')).toBeNull();
      } finally {
        scroll.restore();
      }
    },
  );

  it('retains a failed refresh as stale and repairs bounded counters without a hard reload', async () => {
    const initial = health('2026-10-03T12:00:00.000Z');
    const repaired = health('2026-10-03T12:01:00.000Z', 'projection_unavailable', 5000);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockResolvedValueOnce(response(repaired)),
    );
    const view = render(Page, {
      data: pageData('actor-a', 'org-a', {
        actorId: 'actor-a',
        orgId: 'org-a',
        status: 'ready',
        value: initial,
      }),
    } as never);

    expect(view.getByText('7')).toBeTruthy();
    await fireEvent.click(view.getByRole('button', { name: 'Refresh status' }));
    await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
    expect(view.getByText('7')).toBeTruthy();
    expect(view.getByText(/last successful check/i)).toBeTruthy();

    await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(view.getByText('5000+')).toBeTruthy());
    expect(view.queryByRole('alert')).toBeNull();
    expect(view.getByText('Delivery not ready')).toBeTruthy();
    expect(view.getByText(/whose delivery status is not verified/i)).toBeTruthy();
  });

  it('clears an old organization immediately and rejects its delayed response', async () => {
    const delayedA = deferred<Response>();
    const currentB = health('2026-10-03T12:02:00.000Z', 'runnable', 3);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(delayedA.promise).mockResolvedValueOnce(response(currentB)),
    );
    const view = render(Page, {
      data: pageData('actor-a', 'org-a', {
        actorId: 'actor-a',
        orgId: 'org-a',
        status: 'ready',
        value: health('2026-10-03T12:00:00.000Z', 'runnable', 42),
      }),
    } as never);
    await fireEvent.click(view.getByRole('button', { name: 'Refresh status' }));

    await view.rerender({
      data: pageData('actor-b', 'org-b', {
        actorId: 'actor-b',
        orgId: 'org-b',
        status: 'unavailable',
      }),
    } as never);
    await waitFor(() => expect(view.getByText('Status unavailable')).toBeTruthy());
    expect(view.queryByText('42')).toBeNull();

    delayedA.resolve(response(health('2026-10-03T12:03:00.000Z', 'runnable', 99)));
    await Promise.resolve();
    await Promise.resolve();
    expect(view.queryByText('99')).toBeNull();

    await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(view.getByText('3')).toBeTruthy());
    expect(view.queryByText(/whose delivery status is not verified/i)).toBeNull();
  });
});
