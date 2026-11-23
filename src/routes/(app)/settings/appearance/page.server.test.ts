import { error } from '@sveltejs/kit';
import { expect, it, vi } from 'vitest';
vi.mock('$server/services/organization-branding.service', () => ({
  loadOrganizationBrandingSettings: vi.fn(),
}));
import { loadOrganizationBrandingSettings } from '$server/services/organization-branding.service';
import { load } from './+page.server';
const event = () => ({ locals: {}, depends: vi.fn() }) as unknown as Parameters<typeof load>[0];
it.each([401, 403, 404])(
  'preserves personal appearance access when shared-card admission returns %s',
  async (status) => {
    vi.mocked(loadOrganizationBrandingSettings).mockImplementationOnce(async () =>
      error(status, 'denied'),
    );
    expect(await load(event())).toEqual({ organizationBranding: null });
  },
);
it('registers the shared dependency and retains the independent view/edit projection', async () => {
  const settings = {
    organizationName: 'Faces',
    hubName: null,
    canViewBrandingSettings: false,
    canEditBranding: false,
  };
  vi.mocked(loadOrganizationBrandingSettings).mockResolvedValueOnce(settings as never);
  const e = event();
  expect(await load(e)).toEqual({ organizationBranding: settings });
  expect(e.depends).toHaveBeenCalledWith('app:branding');
});
