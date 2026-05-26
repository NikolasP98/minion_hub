import { randomBytes } from 'node:crypto';

export function generateOpaqueToken(): string {
  return randomBytes(24).toString('base64url'); // 32 url-safe chars
}

export interface LinkUsability {
  revoked: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usesCount: number;
}

export function isLinkUsable(link: LinkUsability, now: Date = new Date()): boolean {
  if (link.revoked) return false;
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return false;
  if (link.maxUses != null && link.usesCount >= link.maxUses) return false;
  return true;
}
