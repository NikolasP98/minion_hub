import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listEntries, listItems } from '$server/services/stock.service';
import { getParty } from '$server/services/party.service';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');
  depends('stock:entries');

  const partyId = url.searchParams.get('party') ?? undefined;
  const [entries, items] = await Promise.all([listEntries(ctx, { partyId }), listItems(ctx)]);
  // Light id→label map so an expanded entry can name its line items without a
  // per-line lookup (the org's item catalog is small).
  const itemsById: Record<string, { code: string; name: string }> = {};
  for (const it of items) itemsById[it.id] = { code: it.code, name: it.name };

  // Small org-scale roster — resolving each distinct party by id is simpler
  // than a new joined query, and entry counts here are in the hundreds, not
  // thousands (ponytail: revisit with a batched lookup if that changes).
  const partyIds = [...new Set(entries.map((e) => e.partyId).filter((x): x is string => !!x))];
  const parties = await Promise.all(partyIds.map((id) => getParty(ctx, id)));
  const partyById = new Map(parties.filter((p) => p != null).map((p) => [p.id, p]));

  return {
    entries: entries.map((e) => ({ ...e, partyName: e.partyId ? (partyById.get(e.partyId)?.name ?? e.partyId) : null })),
    partyFilter: partyId ?? null,
    itemsById,
  };
};
