import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  membership: vi.fn(),
  pending: vi.fn(),
  target: vi.fn(),
  create: vi.fn(),
  resolve: vi.fn(),
  consume: vi.fn(),
  member: vi.fn(),
}));
vi.mock('$server/auth/authorize', () => ({ requireAuth: mocks.auth }));
vi.mock('$server/services/organizations.service', () => ({ listAllOrganizations: vi.fn() }));
vi.mock('$server/services/join/membership', () => ({
  hasAnyMembership: mocks.membership,
  isOrgMember: mocks.member,
}));
vi.mock('$server/services/join/requests.service', () => ({
  getPendingRequestForOrganization: mocks.pending,
  createRequest: mocks.create,
}));
vi.mock('$server/services/join/request-target', () => ({ resolveJoinRequestTarget: mocks.target }));
vi.mock('$server/services/join/links.service', () => ({
  resolveLink: mocks.resolve,
  consumeLink: mocks.consume,
}));
import { actions, load } from './+page.server';
const actor = {
  id: 'own-user',
  supabaseId: 'own-profile',
  email: 'applicant@example.test',
  displayName: 'Applicant',
};
const event = () => ({ locals: {}, url: new URL('http://localhost/join') }) as never;
const formEvent = (message: string | Blob = ' hello ') => {
  const body = new FormData();
  body.set('message', message);
  body.set('targetOrganizationId', 'configured-org');
  body.set('organizationId', 'foreign');
  body.set('userId', 'foreign');
  return {
    locals: {},
    request: new Request('http://localhost/join?/request', { method: 'POST', body }),
  } as never;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockReturnValue(actor);
  mocks.membership.mockResolvedValue(false);
  mocks.pending.mockResolvedValue(null);
  mocks.member.mockResolvedValue(false);
  mocks.target.mockResolvedValue({ id: 'configured-org', name: 'Current workspace' });
});
describe('generic join request flow', () => {
  it('shows a form only after an explicit empty own pending state', async () => {
    expect(await load(event())).toMatchObject({ mode: 'request', email: actor.email });
    expect(mocks.pending).toHaveBeenCalledWith(actor.id, 'configured-org');
  });
  it('keeps the current workspace form available when only another workspace has a pending request', async () => {
    mocks.pending.mockImplementation(async (_user: string, org: string) =>
      org === 'other-org' ? { id: 'other-request', status: 'pending' } : null,
    );
    mocks.membership.mockResolvedValue(true);
    expect(await load(event())).toMatchObject({
      mode: 'request',
      target: { id: 'configured-org', name: 'Current workspace' },
    });
    expect(mocks.member).toHaveBeenCalledWith(actor.supabaseId, 'configured-org');
    expect(mocks.pending).toHaveBeenCalledWith(actor.id, 'configured-org');
    expect(mocks.membership).not.toHaveBeenCalled();
  });
  it('redirects only an own pending request to the current workspace', async () => {
    mocks.pending.mockResolvedValue({ id: 'current-request', status: 'pending' });
    await expect(load(event())).rejects.toMatchObject({ status: 303, location: '/join/sent' });
  });
  it('sends an existing member of the exact target home', async () => {
    mocks.member.mockResolvedValue(true);
    await expect(load(event())).rejects.toMatchObject({ status: 303, location: '/' });
    expect(mocks.pending).not.toHaveBeenCalled();
  });
  it('refuses a form whose target changed before submission without using its old target as authority', async () => {
    mocks.target.mockResolvedValue({ id: 'changed-org', name: 'Changed workspace' });
    expect(await actions.request!(formEvent())).toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps a failed pending read visible instead of offering another request', async () => {
    mocks.pending.mockRejectedValue(new Error('Unavailable'));
    await expect(load(event())).rejects.toThrow('Unavailable');
  });
  it('binds the form write to the authenticated user and shared configured target', async () => {
    await expect(actions.request!(formEvent())).rejects.toMatchObject({
      status: 303,
      location: '/join/sent',
    });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(actor, 'configured-org', 'hello');
    expect(mocks.target).toHaveBeenCalledOnce();
  });
  it('does not write or claim success after ambiguous target resolution', async () => {
    mocks.target.mockRejectedValue(new Error('Ambiguous'));
    await expect(actions.request!(formEvent())).rejects.toThrow('Ambiguous');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['x'.repeat(501), new Blob(['file'])])(
    'rejects invalid form messages before target selection and mutation',
    async (message) => {
      await expect(actions.request!(formEvent(message))).rejects.toMatchObject({ status: 400 });
      expect(mocks.target).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it('preserves invite-token load as read-only', async () => {
    mocks.resolve.mockResolvedValue(null);
    await expect(
      load({ locals: {}, url: new URL('http://localhost/join?token=expired') } as never),
    ).resolves.toMatchObject({ mode: 'link', linkError: expect.any(String) });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.pending).not.toHaveBeenCalled();
  });
  it('bounds form bytes before decoding or selecting a workspace', async () => {
    await expect(actions.request!(formEvent('x'.repeat(4097)))).rejects.toMatchObject({
      status: 413,
    });
    expect(mocks.target).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
