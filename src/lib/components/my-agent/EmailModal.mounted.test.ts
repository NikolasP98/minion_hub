// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { page } from '$app/state';

const rpc = vi.hoisted(() => ({
  getEmailBody: vi.fn(async (id: string) => ({
    id,
    body: 'Hello there',
    from: null,
    subject: null,
    date: null,
  })),
  getEmailSummary: vi.fn(async () => 'AI summary text'),
  draftEmailReply: vi.fn(async () => 'draft'),
}));
vi.mock('$lib/services/my-agent-rpc', () => rpc);

import EmailModal from './EmailModal.svelte';

const item = {
  id: 'm1',
  sourceEmail: 'me@example.test',
  from: 'Ana <ana@example.test>',
  fromName: 'Ana',
  subject: 'Invoice',
  date: '',
  receivedAt: null,
  htmlLink: 'https://mail.example.test/m1',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (page.data as Record<string, unknown>).entitlements;
});

describe('EmailModal and the plan (spec 043)', () => {
  it('without ai: no summary fetch, no banner, no agent actions; the body still shows', async () => {
    (page.data as Record<string, unknown>).entitlements = { plan: 'base', features: [] };
    const view = render(EmailModal, { item, open: true });
    await waitFor(() => expect(view.getByText('Hello there')).toBeTruthy());
    expect(rpc.getEmailSummary).not.toHaveBeenCalled();
    expect(view.queryByText('AI summary text')).toBeNull();
    expect(view.queryByRole('button', { name: /reply/i })).toBeNull();
  });
  it('with ai: summary fetched and shown, reply offered (unchanged)', async () => {
    (page.data as Record<string, unknown>).entitlements = {
      plan: 'premium',
      features: ['ai', 'ai.chat', 'ai.proactive', 'marketplace'],
    };
    const view = render(EmailModal, { item, open: true });
    await waitFor(() => expect(view.getByText('AI summary text')).toBeTruthy());
    expect(rpc.getEmailSummary).toHaveBeenCalledWith('m1', 'me@example.test');
    expect(view.getAllByRole('button', { name: /reply/i }).length).toBeGreaterThan(0);
  });
});
