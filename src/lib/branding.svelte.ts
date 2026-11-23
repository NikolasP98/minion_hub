import { page } from '$app/state';
import { resolveBranding, type Branding } from './branding';

/** Identity belongs to the current request/page, never a mutable server singleton. */
export function getBranding(): Branding {
  const branding = (page.data as { branding?: Branding }).branding;
  return branding ?? resolveBranding(null);
}
