/**
 * Bulk tag add/remove for the floating bulk bar's "Tags" action (spec
 * 2026-09-28 Bundle E #2). Two pieces:
 *  - `tagBulkState`/`tagBulkIntent` — pure tri-state helpers that drive the
 *    popover's checkmarks against the CURRENT selection (Notion-style: a tag
 *    on every selected row shows checked; clicking it removes it everywhere,
 *    clicking any other tag adds it everywhere).
 *  - `bulkLinkTags` — the one client call. `stock`/`catalog` share the
 *    polymorphic `tag_links` table (`item`/`product` kinds) via the new
 *    `POST /api/tags/bulk`. `crm` contacts keep their OWN join
 *    (`crm_contact_tags` — see tag-links.service.ts), so there is no shared
 *    entity kind for them; this fans out to the existing per-contact
 *    `/api/crm/contacts/[id]/tags` endpoint instead of inventing a second
 *    bulk route for one scope.
 */
import type { TagEntityKind, TagScope } from '$lib/tags/scope';

export type TagBulkState = 'all' | 'some' | 'none';

/** Is `tagId` on ALL / SOME / NONE of the selected rows' current tag ids? */
export function tagBulkState(rowsTagIds: string[][], tagId: string): TagBulkState {
  if (rowsTagIds.length === 0) return 'none';
  const count = rowsTagIds.filter((ids) => ids.includes(tagId)).length;
  if (count === 0) return 'none';
  return count === rowsTagIds.length ? 'all' : 'some';
}

/** What clicking a tag in that state should stage: fully-applied ⇒ remove it
 *  everywhere; anything else (none/some) ⇒ add it everywhere. */
export function tagBulkIntent(state: TagBulkState): 'add' | 'remove' {
  return state === 'all' ? 'remove' : 'add';
}

const KIND_OF_SCOPE: Partial<Record<TagScope, TagEntityKind>> = {
  stock: 'item',
  catalog: 'product',
};

async function post(url: string, body?: unknown) {
  await fetch(url, {
    method: body ? 'POST' : 'DELETE',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Apply staged `add`/`remove` tag ids to every row in `ids`, for `scope`. */
export async function bulkLinkTags(
  scope: TagScope,
  ids: string[],
  add: string[],
  remove: string[],
): Promise<void> {
  if (!ids.length || (!add.length && !remove.length)) return;
  const kind = KIND_OF_SCOPE[scope];
  if (kind) {
    await fetch('/api/tags/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope, add, remove, targets: ids.map((id) => ({ type: kind, id })) }),
    });
    return;
  }
  if (scope === 'crm') {
    // TODO(handoff): one fetch per (row × tag) — fine for the bulk bar's
    // typical selection sizes, but batch server-side if CRM ever gets a
    // dedicated bulk-contact-tags endpoint. proposals/2026-09-28-hub-table-open-modes-followups.md §E2
    await Promise.all(
      ids.flatMap((id) => [
        ...add.map((tagId) => post(`/api/crm/contacts/${id}/tags`, { tagId })),
        ...remove.map((tagId) => post(`/api/crm/contacts/${id}/tags?tagId=${tagId}`)),
      ]),
    );
  }
}
