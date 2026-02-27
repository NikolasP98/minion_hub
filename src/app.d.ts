import type { auth } from '$lib/auth';
import type { TenantContext } from '$server/services/base';

declare global {
  namespace App {
    interface Locals {
      user?: {
        id: string;
        email: string;
        displayName: string | null;
      };
      session?: typeof auth.$Infer.Session.session;
      orgId?: string;
      tenantCtx?: TenantContext;
      // serverId is set for metrics Bearer-token auth
      serverId?: string;
    }
  }
}

export {};
