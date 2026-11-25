// @vitest-environment happy-dom
/** Spec 139 S3: the reminder follow-up section of the booking drawer. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import ReconfirmSection from './ReconfirmSection.svelte';
import type { ReconfirmCase } from './ReconfirmSection.svelte';

const caseOf = (over: Partial<ReconfirmCase> = {}): ReconfirmCase => ({
  id: 'case-1',
  open: true,
  agentState: 'none',
  result: null,
  closeAction: null,
  contactId: 'contact-1',
  masked: false,
  events: [{ kind: 'verdict', content: 'no voy a poder', createdAt: '2026-11-25T14:00:00.000Z' }],
  ...over,
});

const base = {
  phone: '+51999000111' as string | null,
  startLabel: 'Dec 1, 17:30',
  fmt: (iso: string) => `at ${iso.slice(11, 16)}`,
  live: true,
  canEdit: true,
  canManage: true,
};
const mount = (
  reconfirm: ReconfirmCase,
  over: Partial<typeof base> & Record<string, unknown> = {},
  handlers = {},
) =>
  render(ReconfirmSection, {
    ...base,
    reconfirm,
    onreschedule: () => {},
    oncancel: () => {},
    onclosed: () => {},
    ...handlers,
    ...over,
  });

let posts: string[];
let status = 200;
beforeEach(() => {
  posts = [];
  status = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      posts.push(String(url));
      return Response.json({ ok: status === 200 }, { status });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReconfirmSection', () => {
  it('while the agent asks: badge, what the client said, conversation link, no actions', () => {
    const v = mount(caseOf({ agentState: 'asking' }));
    expect(v.getByText('Asking')).toBeTruthy();
    expect(v.getByText(/The agent is checking with the client\./)).toBeTruthy();
    expect(v.getByText(/Replied “no voy a poder” on at 14:00\./)).toBeTruthy();
    expect(v.getByRole('link', { name: 'View conversation' }).getAttribute('href')).toBe(
      '/crm/contact-1',
    );
    expect(v.queryByRole('button', { name: /Reschedule|Cancel appointment|Handled/ })).toBeNull();
  });

  it('a client who does not want to continue: the four actions', () => {
    const v = mount(caseOf({ agentState: 'done', result: 'declined' }));
    expect(v.getByText("Doesn't want to continue")).toBeTruthy();
    expect(v.getByRole('button', { name: 'Reschedule' })).toBeTruthy();
    expect(v.getByRole('button', { name: 'Cancel appointment' })).toBeTruthy();
    expect(v.getByRole('link', { name: 'Call' }).getAttribute('href')).toBe('tel:+51999000111');
    expect(v.getByRole('button', { name: 'Mark as handled' })).toBeTruthy();
  });

  it('no answer: only Call and Handled, and the text asks to call', () => {
    const v = mount(caseOf({ agentState: 'done', result: 'no_answer' }));
    expect(v.getByText('No answer')).toBeTruthy();
    expect(v.getByText(/Call them to confirm the appointment\./)).toBeTruthy();
    expect(v.queryByRole('button', { name: 'Reschedule' })).toBeNull();
    expect(v.queryByRole('button', { name: 'Cancel appointment' })).toBeNull();
    expect(v.getByRole('link', { name: 'Call' })).toBeTruthy();
    expect(v.getByRole('button', { name: 'Mark as handled' })).toBeTruthy();
  });

  it('closed by the agent: the result and the new time, no actions', () => {
    const v = mount(
      caseOf({ open: false, agentState: 'done', result: 'rescheduled', closeAction: 'agent' }),
    );
    expect(v.getByText('Closed')).toBeTruthy();
    expect(v.getByText('Rescheduled by the agent to Dec 1, 17:30.')).toBeTruthy();
    expect(v.queryByRole('button', { name: 'Mark as handled' })).toBeNull();
  });

  it('Reschedule and Cancel appointment hand over to the host and write nothing themselves', async () => {
    const onreschedule = vi.fn();
    const oncancel = vi.fn();
    const v = mount(
      caseOf({ agentState: 'done', result: 'declined' }),
      {},
      { onreschedule, oncancel },
    );
    await fireEvent.click(v.getByRole('button', { name: 'Reschedule' }));
    await fireEvent.click(v.getByRole('button', { name: 'Cancel appointment' }));
    expect(onreschedule).toHaveBeenCalledTimes(1);
    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(posts).toEqual([]);
  });

  it('Mark as handled posts to the close route and calls onclosed', async () => {
    const onclosed = vi.fn();
    const v = mount(caseOf({ agentState: 'done', result: 'declined' }), {}, { onclosed });
    await fireEvent.click(v.getByRole('button', { name: 'Mark as handled' }));
    await waitFor(() => expect(onclosed).toHaveBeenCalledTimes(1));
    expect(posts).toEqual(['/api/scheduling/reconfirmations/case-1/close']);
  });

  it('a refused close shows the permission message and does not call onclosed', async () => {
    status = 403;
    const onclosed = vi.fn();
    const v = mount(caseOf({ agentState: 'done', result: 'declined' }), {}, { onclosed });
    await fireEvent.click(v.getByRole('button', { name: 'Mark as handled' }));
    await waitFor(() => expect(v.getByRole('alert').textContent).toMatch(/Your role cannot close/));
    expect(onclosed).not.toHaveBeenCalled();
  });

  it('without scheduling:manage there is no Handled action; without edit no Reschedule/Cancel', () => {
    const v = mount(caseOf({ agentState: 'done', result: 'declined' }), {
      canManage: false,
      canEdit: false,
    });
    expect(v.queryByRole('button', { name: 'Mark as handled' })).toBeNull();
    expect(v.queryByRole('button', { name: 'Reschedule' })).toBeNull();
    expect(v.getByRole('link', { name: 'Call' })).toBeTruthy();
  });

  it('a viewer without PII access sees no message text and no call action', () => {
    const v = mount(caseOf({ agentState: 'done', result: 'unclear', masked: true }), {
      phone: null,
    });
    expect(v.container.textContent).not.toContain('no voy a poder');
    expect(v.queryByRole('link', { name: 'Call' })).toBeNull();
  });

  it('the conversation link is absent when there is no contact', () => {
    const v = mount(caseOf({ agentState: 'asking', contactId: null }));
    expect(v.queryByRole('link', { name: 'View conversation' })).toBeNull();
  });
});
