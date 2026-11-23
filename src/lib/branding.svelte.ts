import { page } from '$app/state';
import { brandingValidationAvailable, resolveBranding, type Branding } from './branding';

/** Identity belongs to the current request/page, never a mutable server singleton. */
export function getBranding(): Branding {
  const branding = (page.data as { branding?: Branding }).branding;
  if (!brandingValidationAvailable())
    return { ...resolveBranding(null, 'unavailable'), orgId: branding?.orgId ?? null };
  return branding ?? resolveBranding(null);
}
