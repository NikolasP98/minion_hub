import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { publicBase } from '$server/mcp/base-url';
import { createCode, getClient } from '$server/mcp/oauth.service';
import {
  CHALLENGE_RE,
  cleanAppName,
  redirectMatches,
  resourceMatches,
} from '$server/mcp/oauth-logic';
import { loadCanonicalMemberships } from '$server/services/canonical-directory.service';

/**
 * Approval screen of the hub's MCP sign-in (spec 143 D10, P5, P12). Everything that matters is
 * re-validated from the URL on every request, never from the form: the form supplies only the
 * organization. An invalid app or return address renders an error page and NEVER redirects;
 * every redirect target is the registered, re-validated `redirect_uri`, and carries `iss`.
 */
type Parsed =
  | {
      ok: true;
      clientName: string;
      registeredAt: number;
      clientId: string;
      redirectUri: string;
      state: string | null;
      challenge: string;
    }
  | { ok: false; page: true }
  | { ok: false; page: false; back: URL };

const MAX_STATE = 512;

async function parse(url: URL): Promise<Parsed> {
  const q = url.searchParams;
  const client = q.get('client_id') ? await getClient(q.get('client_id')!) : null;
  const redirectUri = q.get('redirect_uri');
  if (!client || !redirectUri || !redirectMatches(redirectUri, client.redirectUris))
    return { ok: false, page: true };

  const state = q.get('state');
  const back = (error: string) => {
    const target = answer(redirectUri, state);
    target.searchParams.set('error', error);
    return { ok: false, page: false, back: target } as const;
  };
  const challenge = q.get('code_challenge') ?? '';
  if (
    q.get('response_type') !== 'code' ||
    q.get('code_challenge_method') !== 'S256' ||
    !CHALLENGE_RE.test(challenge) ||
    (state?.length ?? 0) > MAX_STATE
  )
    return back('invalid_request');
  const resource = q.get('resource');
  if (resource !== null && !resourceMatches(resource, publicBase())) return back('invalid_target');
  return {
    ok: true,
    clientName: cleanAppName(client.name),
    registeredAt: client.createdAt.getTime(),
    clientId: client.id,
    redirectUri,
    state,
    challenge,
  };
}

/** The registered return address with the response parameters every answer carries (`iss`, `state`). */
function answer(redirectUri: string, state: string | null): URL {
  const target = new URL(redirectUri);
  target.searchParams.set('iss', publicBase());
  if (state && state.length <= MAX_STATE) target.searchParams.set('state', state);
  return target;
}

/** Never framed, never cached, and the request URL is not leaked in a referrer (P5, D10). */
const guardPage = (setHeaders: (h: Record<string, string>) => void) =>
  setHeaders({
    'content-security-policy': "frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  });

function signedIn(locals: App.Locals, url: URL): string {
  const id = locals.user?.supabaseId;
  if (!id)
    throw redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
  return id;
}

/** The decision is a same-origin form post; assert it here as well as in the hook (P1). */
const sameOrigin = (request: Request, url: URL) => request.headers.get('origin') === url.origin;

export const load: PageServerLoad = async ({ url, locals, setHeaders }) => {
  guardPage(setHeaders);
  const userId = signedIn(locals, url);
  const req = await parse(url);
  if (!req.ok) {
    if (req.page) return { valid: false as const };
    throw redirect(303, req.back);
  }
  const orgs = (await loadCanonicalMemberships(userId)).map((o) => ({ id: o.id, name: o.name }));
  return {
    valid: true as const,
    appName: req.clientName,
    registeredAt: req.registeredAt,
    redirectUri: req.redirectUri,
    orgs,
  };
};

export const actions: Actions = {
  approve: async ({ url, locals, request, setHeaders }) => {
    guardPage(setHeaders);
    if (!sameOrigin(request, url)) return fail(403, { error: 'origin' as const });
    const userId = signedIn(locals, url);
    const req = await parse(url);
    if (!req.ok) {
      if (req.page) return fail(400, { error: 'invalid' as const });
      throw redirect(303, req.back);
    }
    const orgId = (await request.formData()).get('org_id');
    // Only an organization the person belongs to; the choice is fixed for the connection.
    const orgs = await loadCanonicalMemberships(userId);
    if (typeof orgId !== 'string' || !orgs.some((o) => o.id === orgId))
      return fail(400, { error: 'org' as const });
    const code = await createCode({
      clientId: req.clientId,
      userId,
      orgId,
      redirectUri: req.redirectUri,
      codeChallenge: req.challenge,
    });
    const target = answer(req.redirectUri, req.state);
    target.searchParams.set('code', code);
    throw redirect(303, target);
  },

  deny: async ({ url, locals, request, setHeaders }) => {
    guardPage(setHeaders);
    if (!sameOrigin(request, url)) return fail(403, { error: 'origin' as const });
    signedIn(locals, url);
    const req = await parse(url);
    if (!req.ok) {
      if (req.page) return fail(400, { error: 'invalid' as const });
      throw redirect(303, req.back);
    }
    const target = answer(req.redirectUri, req.state);
    target.searchParams.set('error', 'access_denied');
    throw redirect(303, target);
  },
};
