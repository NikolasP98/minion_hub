import { mintIdentity, type IdentityClaims } from '@minion-stack/paperclip-client/identity-jwt';
import { env } from '$env/dynamic/private';

export async function mintWorkforceIdentity(claims: IdentityClaims): Promise<string> {
  // HUB_WORKFORCE_SHARED_SECRET is canonical; HUB_PAPERCLIP_SHARED_SECRET is a
  // compat fallback during the paperclip→workforce rename.
  const secret = env.HUB_WORKFORCE_SHARED_SECRET ?? env.HUB_PAPERCLIP_SHARED_SECRET;
  if (!secret) throw new Error('HUB_WORKFORCE_SHARED_SECRET not set');
  return mintIdentity({ secret, claims, ttlSeconds: 300 });
}
