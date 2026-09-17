import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';

/**
 * "Which backend am I on" (spec 2026-09-16-hub-minion-run-dev-switcher §2.1).
 *
 * Loopback-host matching alone isn't enough: an SSH/Tailscale tunnel that
 * forwards a loopback port to the REAL production pooler would still read as
 * "loopback" and flip this to 'dev', unlocking `/api/dev/switch-user`
 * against real data. Require BOTH:
 *  1. `dev` from `$app/environment` — a build-time constant, `false` in
 *     every `vite build` output (Vercel), so a production deploy can never
 *     satisfy this no matter what env vars leak in.
 *  2. Each URL's port matches the local QA/dev stack's fixed port
 *     (supabase/config.toml: api=54421, db=54422) — a tunnel to a real
 *     pooler is loopback-hosted but never bound to these exact ports.
 */
const LOCAL_API_PORT = '54421';
const LOCAL_DB_PORT = '54422';

function isLoopbackOnPort(raw: string | undefined, expectedPort: string): boolean {
  if (!raw) return false;
  try {
    // URL.hostname keeps the brackets for an IPv6 literal ("[::1]").
    const url = new URL(raw);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const isLoopback = hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
    return isLoopback && url.port === expectedPort;
  } catch {
    return false;
  }
}

export function isDevBackend(
  env: NodeJS.ProcessEnv = process.env,
  isDevBuild: boolean = dev,
): boolean {
  if (!isDevBuild) return false;
  return (
    isLoopbackOnPort(env.PUBLIC_SUPABASE_URL, LOCAL_API_PORT) &&
    isLoopbackOnPort(env.SUPABASE_DB_URL, LOCAL_DB_PORT)
  );
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
