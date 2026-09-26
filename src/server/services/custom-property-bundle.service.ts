import type { CoreCtx } from '$server/auth/core-ctx';
import type { CustomPropertyBundle } from '$lib/tables/custom-properties';
import { authorizeCustomPropertyRecords } from './custom-property-entities.service';
import { inspectCustomPropertyAccess } from './custom-properties-access';
import { listCustomProperties, readCustomPropertyValues } from './custom-properties.service';

/** Canonical page-loader/API bundle. Authorization precedes every definition/value read. */
export async function loadCustomPropertyBundle(
  locals: App.Locals,
  ctx: CoreCtx,
  tableId: string,
  requestedRecordIds: string[],
): Promise<CustomPropertyBundle> {
  const caps = await inspectCustomPropertyAccess(locals, ctx, tableId, 'view');
  if (!caps)
    return { definitions: [], values: {}, recordAccess: {}, canManage: false, canEdit: false };
  const requested = [...new Set(requestedRecordIds)];
  const chunks: string[][] = [];
  for (let offset = 0; offset < requested.length; offset += 500)
    chunks.push(requested.slice(offset, offset + 500));
  const accessChunks = await Promise.all(
    chunks.map((ids) => authorizeCustomPropertyRecords(locals, ctx, tableId, ids, 'view')),
  );
  const recordAccess = Object.assign({}, ...accessChunks) as CustomPropertyBundle['recordAccess'];
  const recordIds = Object.keys(recordAccess);
  const definitions = await listCustomProperties(ctx, tableId);
  const valueChunks = await Promise.all(
    chunks.map((_ids, index) =>
      readCustomPropertyValues(ctx, tableId, recordIds.slice(index * 500, index * 500 + 500)),
    ),
  );
  const values = Object.assign({}, ...valueChunks);
  return { definitions, values, recordAccess, ...caps };
}
