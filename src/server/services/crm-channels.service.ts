/**
 * Live channel-account catalog for the CRM, sourced from the gateway's
 * `channels.status` RPC (the SAME canonical data the flow editor reads). The
 * CRM previously discovered accounts ONLY from the message ledger, so a
 * freshly-linked account with no inbound traffic was invisible and accounts
 * showed a raw id / "Default account" instead of their configured name. This
 * bridges the gateway truth into the account manager.
 *
 * Org-scoping: `gatewayCall` connects with system/admin creds (no JWT orgId),
 * so the gateway returns EVERY account — including ones tagged to other orgs via
 * `channels.accountOrgs`. We therefore re-apply the gateway's own visibility
 * rule (`org-scope.ts#orgScopeVisible`) on the hub using each account's `orgIds`
 * tag, so a tenant only ever sees its own + globally-unscoped accounts.
 */
import { gatewayCall } from '$lib/server/gateway-rpc';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  getAccountScope,
  type AccountScope,
  type ChannelCatalog,
  type CatalogAccount,
} from './crm-contacts.service';

interface RawAccountSnapshot {
  accountId?: string;
  name?: string | null;
  self?: { e164?: string | null; jid?: string | null } | null;
  enabled?: boolean | null;
  /** Org tags from `channels.accountOrgs` (present only on scoped accounts). */
  orgIds?: string[];
}

/**
 * Mirror of gateway `org-scope.ts#orgScopeVisible` (fail-open, back-compat):
 * an account with no `orgIds` is global; otherwise it's visible only to the
 * orgs it's tagged with. Kept inline to avoid importing gateway source.
 */
function orgVisible(resourceOrgIds: string[] | undefined, clientOrgId: string | undefined): boolean {
  if (!clientOrgId) return true;
  if (!resourceOrgIds || resourceOrgIds.length === 0) return true;
  return resourceOrgIds.includes(clientOrgId);
}

/**
 * Fetch the org-visible channel-account catalog from the gateway. Best-effort:
 * returns `null` if the gateway is unreachable / lacks `channels.status`, so the
 * account manager cleanly degrades to the ledger-only view.
 */
export async function getChannelCatalog(ctx: CoreCtx): Promise<ChannelCatalog | null> {
  try {
    const res = await gatewayCall<{
      channelAccounts?: Record<string, RawAccountSnapshot[]>;
      channelDefaultAccountId?: Record<string, string>;
    }>('channels.status', {}, { timeoutMs: 6000 });
    const defaults = res?.channelDefaultAccountId ?? {};
    const accounts: CatalogAccount[] = [];
    for (const [channel, list] of Object.entries(res?.channelAccounts ?? {})) {
      for (const a of list ?? []) {
        if (!a || !a.accountId) continue;
        if (!orgVisible(a.orgIds, ctx.tenantId)) continue;
        accounts.push({
          channel,
          accountId: a.accountId,
          name: a.name?.trim() || null,
          phone: a.self?.e164 ?? a.self?.jid ?? null,
          enabled: a.enabled !== false,
        });
      }
    }
    return { accounts, defaults };
  } catch {
    return null;
  }
}

/**
 * The account manager's full view enriched with the LIVE gateway catalog —
 * canonical names + never-messaged accounts. Use this from loaders/routes; the
 * pure {@link getAccountScope} stays gateway-free (and unit-testable).
 */
export async function getAccountScopeLive(ctx: CoreCtx): Promise<AccountScope> {
  const catalog = await getChannelCatalog(ctx);
  return getAccountScope(ctx, catalog);
}
