import type { TenantContext } from '$server/services/base';
import type { OrgKind } from '$lib/org-kind';
import type { ModuleStates } from '$lib/modules/availability';

declare global {
  interface ImportMetaEnv {
    readonly VITE_DESKTOP?: string;
  }

  namespace App {
    interface Error {
      /** Machine-readable error code, set by stock API's handleStockError
       *  (and any other route that wants a client-distinguishable 409/4xx
       *  without string-matching `message`). */
      code?: string;
    }
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
      /**
       * Org kind resolved once during identity resolution (the same
       * organization_members query that already resolves orgId — no extra
       * getTenant round trip, routing-simplification spec S2/R2).
       * Undefined/null = unresolved. The `(app)` route hook guard
       * ($lib/modules/route-guard.ts) FAILS CLOSED on this for
       * kind-restricted modules — do NOT treat it as "business" the way
       * org-kind.ts's UI-only default does.
       */
      orgKind?: OrgKind | null;
      /**
       * Per-org module-toggle snapshot (modules.service.ts's
       * listModuleStates, cached 5-min TTL + SWR), loaded once per request in
       * hooks.server.ts's finishApp for authenticated `(app)` page requests.
       * Consumed by the route hook guard and by data-bearing route loads
       * that used to call isModuleEnabled directly (routing-simplification
       * spec S2/R3/R5).
       */
      moduleStates?: ModuleStates;
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
