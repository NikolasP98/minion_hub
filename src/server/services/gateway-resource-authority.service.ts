import { createLocalJWKSet, errors, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import { getJwksPublicKeys, gatewayJwtIssuer } from './gateway-jwt.service';
import { decryptToken } from '$server/auth/crypto';
import {
  readGatewayCredentials,
  readWorkshopAuthority,
} from './gateway-resource-authority.repository';

export class GatewayAuthorityError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A gateway bearer identifies a machine; a signed JWT identifies its current user/org. */
export async function authorizeWorkshopSave(input: {
  saveId: string;
  authorization: string | null;
  userJwt: string | null;
  serverId: string | null;
}): Promise<{ saveId: string; orgId: string }> {
  const { saveId, authorization, userJwt } = input;
  const hint = input.serverId?.trim();
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (
    !hint ||
    hint.length > 256 ||
    !bearer ||
    bearer.length > 4096 ||
    !userJwt ||
    userJwt.length > 16384
  ) {
    throw new GatewayAuthorityError(401, 'Credentials required');
  }

  // Load keys outside the JWT catch: an unavailable database is a 503, never a false 401.
  const keys = createLocalJWKSet({ keys: await getJwksPublicKeys() });
  let userId: string;
  let orgId: string;
  try {
    const { payload } = await jwtVerify(userJwt, keys, {
      algorithms: ['EdDSA'],
      issuer: gatewayJwtIssuer(),
      audience: 'openclaw-gateway',
      requiredClaims: ['sub', 'exp', 'iat', 'jti', 'userId', 'orgId'],
    });
    if (
      typeof payload.userId !== 'string' ||
      !UUID.test(payload.userId) ||
      payload.sub !== payload.userId ||
      typeof payload.orgId !== 'string' ||
      !UUID.test(payload.orgId) ||
      typeof payload.jti !== 'string' ||
      !payload.jti.trim() ||
      payload.jti.length > 256 ||
      !Number.isInteger(payload.exp)
    )
      throw new GatewayAuthorityError(401, 'Invalid user credential');
    userId = payload.userId;
    orgId = payload.orgId;
  } catch (error) {
    if (error instanceof errors.JOSEError || error instanceof GatewayAuthorityError) {
      throw new GatewayAuthorityError(401, 'Invalid user credential');
    }
    throw error;
  }

  // Re-read canonical credentials on every admission. Cached metric-token lookups and
  // the legacy database fallback are deliberately not an authorization source here.
  const rows = await readGatewayCredentials(hint);
  const matching = rows.filter((row) => {
    if (row.authMode !== 'token' || !row.token) return false;
    const stored = row.tokenIv ? decryptToken(row.token, row.tokenIv) : row.token;
    const a = Buffer.from(stored);
    const b = Buffer.from(bearer);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  const primary = matching.filter((row) => row.id === hint || row.legacyServerId === hint);
  if (!primary.length) throw new GatewayAuthorityError(401, 'Invalid gateway credential');
  // Assignment aliases must prove BOTH the same URL and the same credential.
  const urls = new Set(primary.map((row) => row.url));
  const gatewayIds = matching.filter((row) => urls.has(row.url)).map((row) => row.id);
  if (!saveId || saveId.length > 119) throw new GatewayAuthorityError(404, 'Save not found');
  const authority = await readWorkshopAuthority({ gatewayIds, userId, orgId, saveId });
  if (!authority.member || !authority.gateway) {
    throw new GatewayAuthorityError(403, 'Workshop access denied');
  }
  if (!authority.save) throw new GatewayAuthorityError(404, 'Save not found');
  return { saveId, orgId };
}
