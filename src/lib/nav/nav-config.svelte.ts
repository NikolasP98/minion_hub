import { page } from '$app/state';
import { EMPTY_NAV_CONFIG, type NavConfig } from './custom-sections';

/** The member's filtered nav config (roles stripped), loaded once by the app layout. */
export function navConfig(): NavConfig {
  return (page.data as { navConfig?: NavConfig }).navConfig ?? EMPTY_NAV_CONFIG;
}
