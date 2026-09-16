import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listClientAccounts, resolveClientAccount } from '$server/services/pos-accounts.service';
import { listSellables } from '$server/services/pos.service';

/** View perm (`pos.accounts:view`) is enforced centrally by the root layout
 *  guard (MODULE_SUBRESOURCES) and the /pos module toggle by the (app) route
 *  hook guard — this load only fetches the tab's data. The per-client
 *  breakdown stays on `/api/pos/accounts/[clientKey]`: the drawer opens for one
 *  row at a time, so loading every client's ledger up front would be waste. */
export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:accounts');

  const [accounts, sellables] = await Promise.all([listClientAccounts(ctx), listSellables(ctx)]);

  // `?client=party:<id>` from the till's customer card. The list holds MOVEMENTS,
  // so a client who has none is simply absent from it — resolve the key off the
  // party spine / CRM contact instead, and the deep link always opens that
  // client's (empty) account rather than an anonymous drawer. Null for a key
  // that names nothing in this org, which closes the drawer instead of opening
  // a blank one.
  const requested = url.searchParams.get('client');
  const requestedClient =
    requested && !accounts.some((a) => a.clientKey === requested)
      ? await resolveClientAccount(ctx, requested).catch(() => null)
      : null;
  // Grants carry `serviceProductId`/`packageProductId` only, so without this the
  // drawer would print uuids. The catalog is ~80 rows — one lookup map beats a
  // join the account query doesn't otherwise need.
  return {
    accounts,
    requestedClient,
    productNames: Object.fromEntries(sellables.map((s) => [s.productId, s.name])) as Record<
      string,
      string
    >,
  };
};
