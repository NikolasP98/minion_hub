import type { TenantContext } from '$server/services/base';

declare global {
  interface ImportMetaEnv {
    readonly VITE_DESKTOP?: string;
  }

  namespace App {
    interface Locals {
      user?: {
        id: string;
        supabaseId?: string;
        email: string;
        displayName: string | null;
        avatarUrl?: string | null;
        role: 'user' | 'admin';
        createdAt?: string | null;
        username?: string | null;
      };
      // Legacy session slot — Better Auth set this; Supabase mode leaves it
      // unset. Kept (minimally typed) for the defensive org-activation read in
      // (app)/+layout.server.ts, which treats "no activeOrganizationId" as the
      // always-true Supabase case.
      session?: { activeOrganizationId?: string | null };
      orgId?: string;
      tenantCtx?: TenantContext;
      // serverId is set for metrics Bearer-token auth
      serverId?: string;
      // workforceIdentity is minted per-request by workforceIdentityHandle in hooks.server.ts
      workforceIdentity?: {
        token: string;
        userId: string;
        companyId: string | null;
      };
    }
  }
}

export {};
