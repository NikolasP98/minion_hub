import type { auth } from '$lib/auth/auth';
import type { TenantContext } from '$server/services/base';

declare global {
  interface ImportMetaEnv {
    readonly VITE_DESKTOP?: string;
  }

  namespace App {
    interface Locals {
      user?: {
        id: string;
        email: string;
        displayName: string | null;
        role: 'user' | 'admin';
      };
      session?: typeof auth.$Infer.Session.session;
      orgId?: string;
      tenantCtx?: TenantContext;
      // serverId is set for metrics Bearer-token auth
      serverId?: string;
      // paperclipIdentity is minted per-request by paperclipIdentityHandle in hooks.server.ts
      paperclipIdentity?: {
        token: string;
        userId: string;
        companyId: string | null;
      };
    }
  }
}

export {};
