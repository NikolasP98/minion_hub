import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '$lib/doors/kinds/form';

const mocks = vi.hoisted(() => ({ resolvePublicDoor: vi.fn() }));
vi.mock('$server/services/doors.service', () => ({
  resolvePublicDoor: mocks.resolvePublicDoor,
  bumpDoorStat: vi.fn(),
  isLikelyBot: () => false,
}));
vi.mock('$server/services/tenant.service', () => ({ getTenant: async () => null }));

import { load } from './+page.server';

const visit = () => {
  const url = new URL('http://hub.test/d/qa-intake');
  return load({
    params: { slug: 'qa-intake' },
    url,
    request: new Request(url),
    setHeaders: () => {},
  } as never);
};
const withConfig = (config: unknown) =>
  mocks.resolvePublicDoor.mockResolvedValue({
    ctx: { tenantId: 'org-1' },
    door: { id: 'd1', kind: 'form', slug: 'qa-intake', title: 'Intake', config },
  });

beforeEach(() => vi.clearAllMocks());

describe('/d/[slug] load', () => {
  it('renders a form door whose config this build reads', async () => {
    withConfig(defaultConfig);
    expect(await visit()).toMatchObject({ kind: 'form', data: { fields: defaultConfig.fields } });
  });

  it('a config this build cannot read (unknown top-level or field key) is a 404, not a 500', async () => {
    withConfig({ ...defaultConfig, embed: true });
    await expect(visit()).rejects.toMatchObject({ status: 404 });
    const fields = defaultConfig.fields.map((f) => ({ ...f, width: 'half' }));
    withConfig({ ...defaultConfig, fields });
    await expect(visit()).rejects.toMatchObject({ status: 404 });
  });
});
