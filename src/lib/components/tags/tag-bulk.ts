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

export type TagBulkOperation = {
  targetId: string;
  tagId: string;
  action: 'add' | 'remove';
};

export type TagBulkOutcome =
  | { status: 'succeeded'; completed: TagBulkOperation[]; pending: [] }
  | {
      status: 'failed' | 'unknown' | 'partial';
      completed: TagBulkOperation[];
      pending: TagBulkOperation[];
      error?: unknown;
    };

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

export function planTagBulkOperations(
  ids: string[],
  add: string[],
  remove: string[],
): TagBulkOperation[] {
  return ids.flatMap((targetId) => [
    ...add.map((tagId): TagBulkOperation => ({ targetId, tagId, action: 'add' })),
    ...remove.map((tagId): TagBulkOperation => ({ targetId, tagId, action: 'remove' })),
  ]);
}

async function sendCrm(operation: TagBulkOperation): Promise<Response> {
  const adding = operation.action === 'add';
  return fetch(
    adding
      ? `/api/crm/contacts/${operation.targetId}/tags`
      : `/api/crm/contacts/${operation.targetId}/tags?tagId=${operation.tagId}`,
    {
      method: adding ? 'POST' : 'DELETE',
      headers: adding ? { 'content-type': 'application/json' } : undefined,
      body: adding ? JSON.stringify({ tagId: operation.tagId }) : undefined,
    },
  );
}

const MAX_CONCURRENT_TAG_REQUESTS = 6;

type AtomicGroup = {
  operations: TagBulkOperation[];
  targetIds: string[];
  add: string[];
  remove: string[];
};

/**
 * The bulk endpoint applies every requested tag to every requested target. Group
 * targets only when their exact add/remove sets match, so an arbitrary repair
 * list can never grow into an accidental target x tag Cartesian product.
 */
function groupAtomicOperations(operations: TagBulkOperation[]): AtomicGroup[] {
  const byTarget = new Map<string, { add: Set<string>; remove: Set<string> }>();
  for (const operation of operations) {
    const target = byTarget.get(operation.targetId) ?? { add: new Set(), remove: new Set() };
    target[operation.action].add(operation.tagId);
    byTarget.set(operation.targetId, target);
  }

  const bySignature = new Map<string, AtomicGroup>();
  for (const [targetId, target] of byTarget) {
    const add = [...target.add].sort();
    const remove = [...target.remove].sort();
    const signature = JSON.stringify({ add, remove });
    const group = bySignature.get(signature) ?? {
      operations: [],
      targetIds: [],
      add,
      remove,
    };
    group.targetIds.push(targetId);
    group.operations.push(
      ...add.map((tagId): TagBulkOperation => ({ targetId, tagId, action: 'add' })),
      ...remove.map((tagId): TagBulkOperation => ({ targetId, tagId, action: 'remove' })),
    );
    bySignature.set(signature, group);
  }
  return [...bySignature.values()];
}

async function settleWithLimit<T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]!) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_TAG_REQUESTS, items.length) }, worker),
  );
  return results;
}

function outcomesFromSettled(
  batches: { operations: TagBulkOperation[] }[],
  settled: PromiseSettledResult<Response>[],
): TagBulkOutcome {
  const completed: TagBulkOperation[] = [];
  const pending: TagBulkOperation[] = [];
  let unknown = false;
  let error: unknown;
  for (const [index, result] of settled.entries()) {
    const operations = batches[index]!.operations;
    if (result.status === 'fulfilled' && result.value.ok) {
      completed.push(...operations);
      continue;
    }
    pending.push(...operations);
    if (result.status === 'rejected') {
      unknown = true;
      error ??= result.reason;
    } else {
      error ??= new Error(`Tag update failed (${result.value.status})`);
    }
  }
  if (!pending.length) return { status: 'succeeded', completed, pending: [] };
  return {
    status: completed.length ? 'partial' : unknown ? 'unknown' : 'failed',
    completed,
    pending,
    error,
  };
}

/** Apply an exact operation list, used by partial CRM repair. */
export async function retryTagBulkOperations(
  scope: TagScope,
  operations: TagBulkOperation[],
): Promise<TagBulkOutcome> {
  if (!operations.length) return { status: 'succeeded', completed: [], pending: [] };
  const kind = KIND_OF_SCOPE[scope];
  if (kind) {
    const groups = groupAtomicOperations(operations);
    const settled = await settleWithLimit(groups, async (group) =>
      fetch('/api/tags/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope,
          add: group.add,
          remove: group.remove,
          targets: group.targetIds.map((id) => ({ type: kind, id })),
        }),
      }),
    );
    return outcomesFromSettled(groups, settled);
  }
  if (scope !== 'crm') {
    return {
      status: 'failed',
      completed: [],
      pending: operations,
      error: new Error('Unsupported tag scope'),
    };
  }

  const batches = operations.map((operation) => ({ operations: [operation] }));
  return outcomesFromSettled(batches, await settleWithLimit(operations, sendCrm));
}

/** Apply staged `add`/`remove` tag ids to every row in `ids`, for `scope`. */
export async function bulkLinkTags(
  scope: TagScope,
  ids: string[],
  add: string[],
  remove: string[],
): Promise<TagBulkOutcome> {
  return retryTagBulkOperations(scope, planTagBulkOperations(ids, add, remove));
}
