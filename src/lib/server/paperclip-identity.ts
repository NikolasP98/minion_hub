import { mintIdentity, type IdentityClaims } from '@minion-stack/paperclip-client/identity-jwt';
import { env } from '$env/dynamic/private';

export async function mintPaperclipIdentity(claims: IdentityClaims): Promise<string> {
  const secret = env.HUB_PAPERCLIP_SHARED_SECRET;
  if (!secret) throw new Error('HUB_PAPERCLIP_SHARED_SECRET not set');
  return mintIdentity({ secret, claims, ttlSeconds: 300 });
}
