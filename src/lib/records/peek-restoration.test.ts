// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { page } from '$app/state';
import { goto, preloadData, pushState } from '$app/navigation';
import { openRecord, currentPeekAuthorityKey, isCurrentPeek } from './peek.svelte';
import { retireRecordPeeks } from './peek-authority';
vi.mock('$lib/records/peek-registry', () => ({ resolvePeekPage: () => ({}) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), preloadData: vi.fn(), pushState: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  page.data = { user: { id: 'actor' }, activeOrgId: 'org' };
  page.url.href = 'https://hub.test/es/crm';
  vi.mocked(preloadData).mockResolvedValue({ type: 'loaded', status: 200, data: {} });
});
it.each([403, 404])('keeps the module view when a remembered panel returns %s', async (status) => {
  vi.mocked(preloadData).mockResolvedValue({ type: 'loaded', status, data: {} });
  await openRecord('/crm/retired', 'tray', { fallbackToPage: false });
  expect(goto).not.toHaveBeenCalled();
  expect(pushState).not.toHaveBeenCalled();
});
it('keeps the module view when remembered-panel preload is offline', async () => {
  vi.mocked(preloadData).mockRejectedValue(new Error('offline'));
  await expect(openRecord('/crm/one', 'modal', { fallbackToPage: false })).resolves.toBeUndefined();
  expect(goto).not.toHaveBeenCalled();
});
it('preserves the ordinary record-link fallback', async () => {
  vi.mocked(preloadData).mockResolvedValue({ type: 'loaded', status: 404, data: {} });
  await openRecord('/crm/missing', 'tray');
  expect(goto).toHaveBeenCalledOnce();
});
it('does not reopen a remembered record after its owner retires', async () => {
  let complete!: (value: { type: 'loaded'; status: number; data: Record<string, unknown> }) => void;
  vi.mocked(preloadData).mockReturnValueOnce(new Promise((resolve) => (complete = resolve)));
  const opening = openRecord('/crm/one', 'tray', { fallbackToPage: false });
  page.data = { user: { id: 'other' }, activeOrgId: 'org' };
  complete({ type: 'loaded', status: 200, data: {} });
  await opening;
  expect(pushState).not.toHaveBeenCalled();
});

it('restores only fresh data returned by the authorized preload', async () => {
  const fresh = { contact: { id: 'one', displayName: 'Fresh' } };
  vi.mocked(preloadData).mockResolvedValue({ type: 'loaded', status: 200, data: fresh });
  await openRecord('/crm/one', 'tray', { fallbackToPage: false });
  expect(goto).not.toHaveBeenCalled();
  expect(pushState).toHaveBeenCalledWith('', {
    peek: { href: '/crm/one', mode: 'tray', data: fresh, authorityKey: currentPeekAuthorityKey() },
  });
});

it('retires a delayed preload after a policy change even when actor/org/generation stay the same', async () => {
  let complete!: (value: { type: 'loaded'; status: number; data: Record<string, unknown> }) => void;
  vi.mocked(preloadData).mockReturnValueOnce(new Promise((resolve) => (complete = resolve)));
  const opening = openRecord('/crm/one', 'tray', { fallbackToPage: false });
  retireRecordPeeks();
  complete({ type: 'loaded', status: 200, data: { privateOwnerData: true } });
  await opening;
  expect(pushState).not.toHaveBeenCalled();
});

it('replaces retired raw history only with fresh authorized preload data', async () => {
  const old = {
    href: '/crm/one',
    mode: 'tray' as const,
    data: { secret: 'OLD OWNER ROW' },
    authorityKey: currentPeekAuthorityKey()!,
  };
  retireRecordPeeks();
  expect(isCurrentPeek(old)).toBe(false);
  const fresh = { contact: { id: 'one', email: null, masked: true } };
  vi.mocked(preloadData).mockResolvedValue({ type: 'loaded', status: 200, data: fresh });
  await openRecord(old.href, old.mode, { fallbackToPage: false });
  expect(pushState).toHaveBeenCalledWith('', {
    peek: { href: old.href, mode: old.mode, data: fresh, authorityKey: currentPeekAuthorityKey() },
  });
});

it('never restores a raw payload from another browser Document', () => {
  const previous = {
    href: '/crm/one',
    mode: 'tray' as const,
    data: {},
    authorityKey: currentPeekAuthorityKey()!,
  };
  const replacement = document.implementation.createHTMLDocument('replacement');
  vi.stubGlobal('document', replacement);
  try {
    expect(isCurrentPeek(previous)).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('does not publish an old preload failure after its authority retires', async () => {
  let fail!: (reason: unknown) => void;
  vi.mocked(preloadData).mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const opening = openRecord('/crm/one', 'tray');
  retireRecordPeeks();
  fail(new DOMException('retired read', 'AbortError'));
  await expect(opening).resolves.toBeUndefined();
  expect(pushState).not.toHaveBeenCalled();
  expect(goto).not.toHaveBeenCalled();
});
