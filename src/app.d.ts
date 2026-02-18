import type { TenantContext } from '$server/services/base';

declare global {
  namespace App {
    interface Locals {
      user?: {
        id: string;
        email: string;
        displayName: string | null;
      };
      tenantCtx?: TenantContext;
      role?: 'owner' | 'admin' | 'member' | 'viewer';
    }
  }
}

export {};
