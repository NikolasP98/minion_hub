#!/usr/bin/env bun
/**
 * `bun scripts/qa/smoke-dev-switcher.ts` — CI `qa-stack` job smoke test for
 * spec 2026-09-16-hub-minion-run-dev-switcher §6: password-login as the
 * seeded owner, list DEV users, switch to the viewer, prove the switch took
 * (`/api/me` returns the viewer, `/en/pos/sell` is no longer reachable —
 * viewer has `pos:view` but not the `pos:create` `/pos/sell` requires),
 * switch back to the owner, prove `/en/pos/sell` is reachable again. Also
 * folds in the seed-contract case from spec §3 (every `tenancy.user.*`
 * persona is listed) — that assertion needs the live app + seeded DB, so it
 * can't run as a plain vitest unit test; see `dev-backend.test.ts` /
 * `users/server.test.ts` for what DOES run there.
 *
 * Run against the app this job already started with `bun run dev` on
 * :5199 (loopback Supabase from `.env`), so `locals.backend === 'dev'`.
 */
import { MATRIX } from './seed/matrix';
import { personaEmail, QA_PASSWORD } from './seed/ids';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5199';
const PASSWORD = process.env.QA_SEED_PASSWORD ?? QA_PASSWORD;

const OWNER_EMAIL = personaEmail('tenancy.user.owner');
const VIEWER_EMAIL = personaEmail('tenancy.user.viewer');

const TENANCY_PERSONA_EMAILS = MATRIX.filter(
  (e) => e.domain === 'tenancy' && e.id.startsWith('tenancy.user.'),
).map((e) => personaEmail(e.id));

/** Minimal cookie jar — Bun's fetch doesn't persist cookies across calls. */
class CookieJar {
  private readonly store = new Map<string, string>();

  header(): string {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const maxAgeMatch = /max-age=0/i.test(raw);
      const expiredMatch = /expires=Thu, 01 Jan 1970/i.test(raw);
      if (maxAgeMatch || expiredMatch) this.store.delete(name);
      else this.store.set(name, value);
    }
  }
}

const jar = new CookieJar();

async function call(path: string, init: RequestInit & { expect?: number } = {}): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set('cookie', cookie);
  if (init.method && init.method !== 'GET') headers.set('origin', BASE_URL);
  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar.absorb(res);
  if (init.expect !== undefined && res.status !== init.expect) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(
      `${init.method ?? 'GET'} ${path} -> ${res.status} (want ${init.expect})\n${body.slice(0, 500)}`,
    );
  }
  return res;
}

async function login(email: string): Promise<void> {
  await call('/api/auth/password-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
    expect: 200,
  });
}

async function switchTo(userId: string): Promise<void> {
  await call('/api/dev/switch-user', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
    expect: 200,
  });
}

async function meEmail(): Promise<string> {
  const res = await call('/api/me', { expect: 200 });
  const body = (await res.json()) as { email: string };
  return body.email;
}

interface DevUser {
  id: string;
  email: string | null;
}

async function main(): Promise<void> {
  console.log(`[smoke-dev-switcher] base URL: ${BASE_URL}`);

  console.log('[smoke-dev-switcher] logging in as the owner persona');
  await login(OWNER_EMAIL);

  console.log('[smoke-dev-switcher] GET /api/dev/users');
  const listRes = await call('/api/dev/users', { expect: 200 });
  const { users } = (await listRes.json()) as { users: DevUser[] };

  const listedEmails = new Set(users.map((u) => u.email));
  const missing = TENANCY_PERSONA_EMAILS.filter((email) => !listedEmails.has(email));
  if (missing.length > 0) {
    throw new Error(
      `/api/dev/users is missing tenancy.user.* personas: ${missing.join(', ')} (seed §3 contract)`,
    );
  }
  console.log(
    `[smoke-dev-switcher] all ${TENANCY_PERSONA_EMAILS.length} tenancy.user.* personas listed`,
  );

  const viewer = users.find((u) => u.email === VIEWER_EMAIL);
  if (!viewer) throw new Error(`viewer persona ${VIEWER_EMAIL} not found in /api/dev/users`);
  const owner = users.find((u) => u.email === OWNER_EMAIL);
  if (!owner) throw new Error(`owner persona ${OWNER_EMAIL} not found in /api/dev/users`);

  console.log('[smoke-dev-switcher] switching to the viewer persona');
  await switchTo(viewer.id);
  const asViewerEmail = await meEmail();
  if (asViewerEmail !== VIEWER_EMAIL) {
    throw new Error(`/api/me after switch -> ${asViewerEmail}, want ${VIEWER_EMAIL}`);
  }

  console.log('[smoke-dev-switcher] GET /en/pos/sell as the viewer (want != 200)');
  const sellAsViewer = await call('/en/pos/sell');
  if (sellAsViewer.status === 200) {
    throw new Error(`/en/pos/sell returned 200 for the viewer persona (want 403/302)`);
  }
  console.log(`[smoke-dev-switcher] /en/pos/sell -> ${sellAsViewer.status} (correctly blocked)`);

  console.log('[smoke-dev-switcher] switching back to the owner persona');
  await switchTo(owner.id);
  const asOwnerEmail = await meEmail();
  if (asOwnerEmail !== OWNER_EMAIL) {
    throw new Error(`/api/me after switch-back -> ${asOwnerEmail}, want ${OWNER_EMAIL}`);
  }

  console.log('[smoke-dev-switcher] GET /en/pos/sell as the owner (want 200)');
  await call('/en/pos/sell', { expect: 200 });

  console.log('[smoke-dev-switcher] OK');
}

main().catch((err) => {
  console.error('[smoke-dev-switcher] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
