import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  assertContactTaggable: vi.fn(),
  createTag: vi.fn(),
  applyTag: vi.fn(),
}));
vi.mock('../_shared/action-auth', () => ({
  requireAssistantCapability: async () => ({ ctx: { tenantId: 'o' }, principalId: 'p' }),
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  assertContactTaggable: mocks.assertContactTaggable,
  createTag: mocks.createTag,
  applyTag: mocks.applyTag,
  removeTag: vi.fn(),
  listTags: async () => [],
}));
import { POST } from './contact-tag/+server';

const post = (body: unknown) =>
  POST({
    locals: {},
    url: new URL('http://x/?agentId=personal-u'),
    request: { json: async () => body },
  } as never);

beforeEach(() => vi.clearAllMocks());

describe('gateway contact-tag', () => {
  it('creates no tag when the contact is refused', async () => {
    mocks.assertContactTaggable.mockImplementation(async () => {
      throw error(404, 'Contact not found');
    });
    await expect(
      post({ confirm: true, contactId: 'nope', tag: 'Modelo', op: 'add' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.createTag).not.toHaveBeenCalled();
  });
  it('rejects a non-UUID tagId', async () => {
    await expect(
      post({ confirm: true, contactId: 'c', tagId: 'x', op: 'add' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
