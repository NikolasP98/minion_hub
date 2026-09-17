import { error } from '@sveltejs/kit';

/**
 * "Which backend am I on" (spec 2026-09-16-hub-minion-run-dev-switcher §2.1).
 *
 * The only reliable signal is the Supabase connection target: true iff BOTH
 * `PUBLIC_SUPABASE_URL` and `SUPABASE_DB_URL` are set and point at loopback
 * (127.0.0.1 / ::1 / localhost). Anything else — missing, hosted, LAN — is
 * 'prd'. This can't be spoofed by a flag and is false in every deployed
 * environment (Vercel never sets these to loopback hosts).
 */
function isLoopbackHost(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    // URL.hostname keeps the brackets for an IPv6 literal ("[::1]").
    const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '');
    return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
  } catch {
    return false;
  }
}

export function isDevBackend(env: NodeJS.ProcessEnv = process.env): boolean {
  return isLoopbackHost(env.PUBLIC_SUPABASE_URL) && isLoopbackHost(env.SUPABASE_DB_URL);
}

/**
 * Guard for every `/api/dev/*` handler. `locals.backend` is set once per
 * process by hooks.server.ts (from `isDevBackend()`), never recomputed per
 * request. 404 (not 403) so the surface is indistinguishable from "does not
 * exist" against a production backend.
 */
export function requireDevBackend(locals: App.Locals): void {
  if (locals.backend !== 'dev') throw error(404, 'Not found');
}
