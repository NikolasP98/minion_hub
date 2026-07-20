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
      /** Build channel this request selected (spec §D4). Set by
       * buildChannelHandle from the client's cookie; 'prd' unless explicitly
       * 'dev'. Read it directly, or `currentBuildChannel()` where locals
       * aren't in reach. */
      buildChannel?: 'dev' | 'prd';
      tenantCtx?: TenantContext;
      // serverId is set for metrics Bearer-token auth
      serverId?: string;
      // workforceIdentity is minted per-request by workforceIdentityHandle in hooks.server.ts
      workforceIdentity?: {
        token: string;
        userId: string;
        companyId: string | null;
        roleKeys: string[];
        roleAuthority: 'signed' | 'board';
      };
    }
  }
}

export {};
