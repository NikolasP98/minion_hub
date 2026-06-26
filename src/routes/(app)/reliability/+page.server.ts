import type { PageServerLoad } from './$types';

// Access is enforced by the central RBAC route guard in (app)/+layout.server.ts
// (`reliability:view`), replacing the old admin-only super-view check.
export const load: PageServerLoad = async () => {
  return {};
};
