// Human-readable explanations for gateway connect/close failures.
//
// The gateway surfaces terse machine reasons (e.g. "jwt_required",
// "connection_limit_exceeded") in WS 1008 close frames and connect rejections.
// Several are actively misleading — most notably `jwt_required`, which the
// gateway returns when the *shared token* auth failed (not when a JWT is
// literally missing): see src/gateway/server/ws-jwt-auth.ts (Case 3 fires only
// when `existingAuthMethod` is undefined, i.e. token/password auth did NOT
// succeed). This maps each raw reason to a title + actionable hint so the UI can
// explain what actually went wrong and what to do about it.

export type GatewayErrorCtaKind = 'hosts-edit' | 'retry' | 'none';

export interface GatewayErrorInfo {
  /** Short human title (the headline). */
  title: string;
  /** One-sentence actionable explanation. */
  hint: string;
  /** The raw machine reason, kept for debugging/support. */
  raw: string;
  /** Suggested primary action for the UI to offer. */
  cta: GatewayErrorCtaKind;
}

const norm = (s: string) => s.toLowerCase();

/**
 * Translate a raw gateway close/connect reason into a human-readable
 * explanation. Always returns something sensible — unknown reasons fall back to
 * a generic message that still shows the raw string.
 */
export function describeGatewayError(rawReason: string | null | undefined): GatewayErrorInfo {
  const raw = (rawReason ?? '').trim();
  const r = norm(raw);

  // jwt_required — MISLEADING: means shared-token auth failed (no valid token),
  // not that a JWT is missing. This is the common "host token is wrong/empty" case.
  if (r === 'jwt_required' || r.includes('jwt_required')) {
    return {
      title: 'Gateway rejected this host’s token',
      hint: 'The saved token for this gateway is missing or no longer valid. Open Hosts → Edit, paste a fresh token, then reconnect.',
      raw,
      cta: 'hosts-edit',
    };
  }

  // JWT identity validation failures (issuer/audience/expiry/signature).
  if (
    r.includes('jwt') &&
    (r.includes('valid') ||
      r.includes('expired') ||
      r.includes('issuer') ||
      r.includes('audience') ||
      r.includes('signature') ||
      r.includes('rejected'))
  ) {
    return {
      title: 'Identity token rejected',
      hint: 'The hub’s identity token was rejected by the gateway. The dashboard will retry on shared-token auth automatically; org-scoping may be unavailable until the gateway’s OIDC config is refreshed.',
      raw,
      cta: 'retry',
    };
  }

  // Token revoked.
  if (r.includes('revoke')) {
    return {
      title: 'Access token revoked',
      hint: 'This gateway access token was revoked. Rotate the host token in Hosts → Edit, then reconnect.',
      raw,
      cta: 'hosts-edit',
    };
  }

  // Device pairing required.
  if (
    r.includes('not paired') ||
    r.includes('not_paired') ||
    r.includes('pairing required') ||
    r.includes('device identity required')
  ) {
    return {
      title: 'This host needs a fresh token',
      hint: 'The gateway didn’t recognise this connection’s credential. Rotate the host token in Hosts → Edit, then reconnect.',
      raw,
      cta: 'hosts-edit',
    };
  }

  // Browser-origin rejected by the gateway's control-UI allowlist. Seen
  // transiently when a gateway restarts mid-update with an incomplete config
  // (plugin manifests unreadable → config validation fails → allowlist empty)
  // — NOT a token problem, so don't send people to rotate tokens.
  if (r.includes('origin not allowed')) {
    return {
      title: 'Gateway refused this page’s origin',
      hint: 'The gateway didn’t accept connections from this hub URL. If an update or restart is in progress this usually resolves itself in a minute — otherwise add this hub’s URL to gateway.controlUi.allowedOrigins.',
      raw,
      cta: 'retry',
    };
  }

  // Per-user connection limit.
  if (r.includes('connection_limit') || r.includes('too many connections')) {
    return {
      title: 'Connection limit reached',
      hint: 'You have too many active gateway connections. Close other tabs or devices connected to this gateway, then retry.',
      raw,
      cta: 'retry',
    };
  }

  // Token present but wrong / unauthorised.
  if (
    r.includes('unauthor') ||
    r.includes('invalid token') ||
    r.includes('invalid_token') ||
    r.includes('forbidden') ||
    r === '401' ||
    r === '403'
  ) {
    return {
      title: 'Not authorised for this gateway',
      hint: 'Your account isn’t permitted to connect to this gateway, or its token is invalid. Check access in Hosts → Edit.',
      raw,
      cta: 'hosts-edit',
    };
  }

  // Couldn't even load the token from the hub (offline / not logged in).
  if (r.includes('could not load gateway token') || r.includes('token unavailable')) {
    return {
      title: 'Couldn’t load the gateway token',
      hint: 'The hub couldn’t hand out this gateway’s token. Make sure you’re still signed in, then retry.',
      raw,
      cta: 'retry',
    };
  }

  // Network / reachability (WS failed to open, timeouts, DNS, refused).
  if (
    r.includes('econnrefused') ||
    r.includes('timeout') ||
    r.includes('timed out') ||
    r.includes('network') ||
    r.includes('failed to fetch') ||
    r.includes('websocket') ||
    r.includes('enotfound') ||
    r.includes('closed before') ||
    r === '' ||
    r === 'not connected'
  ) {
    return {
      title: 'Can’t reach the gateway',
      hint: 'The gateway server didn’t respond. Check that it’s online and that the host URL is correct in Hosts → Edit.',
      raw: raw || 'connection closed',
      cta: 'retry',
    };
  }

  // Unknown — generic, but keep the raw reason visible.
  return {
    title: 'Gateway connection failed',
    hint: raw
      ? `The gateway closed the connection (${raw}). It will keep retrying; rotate the host token in Hosts → Edit if it persists.`
      : 'The gateway connection dropped. It will keep retrying automatically.',
    raw: raw || 'unknown',
    cta: 'retry',
  };
}
