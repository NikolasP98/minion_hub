import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  // Only check that a token is present — do NOT verify it here. The recovery
  // token is single-use, and email link-scanners GET this URL before the user
  // clicks; verifying on load would let a scanner consume the token (and be
  // handed the session cookies). Verification happens on explicit submit via
  // POST /api/auth/reset-password.
  const tokenHash = event.url.searchParams.get('token_hash');
  return { ok: Boolean(tokenHash), tokenHash };
};
