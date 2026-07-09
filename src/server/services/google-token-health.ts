import type { GoogleAdc } from './identity-secrets';

/**
 * Live health probe for a stored Google refresh token.
 *
 * Exchanges the refresh token at Google's token endpoint and inspects the
 * GRANTED scopes of the resulting access token. This is what catches the
 * "linked before we requested Gmail scopes" failure mode: the token is valid
 * but the Gmail API 403s with insufficient scopes, which the feed pullers
 * swallow silently. Only booleans leave this module — never tokens.
 */
export type GoogleTokenHealth =
  | { ok: true; hasGmail: boolean; hasCalendar: boolean }
  | { ok: false; reason: 'revoked' | 'unreachable' };

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const PROBE_TIMEOUT_MS = 6000;

export async function probeGoogleToken(adc: GoogleAdc): Promise<GoogleTokenHealth> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: adc.client_id,
        client_secret: adc.client_secret,
        refresh_token: adc.refresh_token,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      // invalid_grant = revoked/expired consent — the account must reconnect.
      if (body.error === 'invalid_grant') return { ok: false, reason: 'revoked' };
      return { ok: false, reason: 'unreachable' };
    }
    const body = (await res.json()) as { scope?: string };
    const scopes = (body.scope ?? '').split(/\s+/);
    return {
      ok: true,
      hasGmail: scopes.some((s) => s.includes('/auth/gmail.')),
      hasCalendar: scopes.some((s) => s.includes('/auth/calendar')),
    };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
