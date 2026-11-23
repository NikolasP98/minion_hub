import type { PageServerLoad } from './$types';
import { isHttpError } from '@sveltejs/kit';
import { loadOrganizationBrandingSettings } from '$server/services/organization-branding.service';

/** Personal appearance remains available to every authenticated account. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:branding');
  try {
    return { organizationBranding: await loadOrganizationBrandingSettings(locals) };
  } catch (cause) {
    if (isHttpError(cause) && [401, 403, 404].includes(cause.status))
      return { organizationBranding: null };
    throw cause;
  }
};
