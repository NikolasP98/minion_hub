import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireCustomPropertyAccess } from '$server/services/custom-properties-access';
import { listCustomProperties } from '$server/services/custom-properties.service';
import {
  formulaCatalogRevision,
  loadFormulaCatalog,
} from '$server/services/formula-properties.service';
import { propertyApiError, requireActor } from '../../api';

const FUNCTIONS = ['ROUND', 'ABS', 'COALESCE', 'NULLIF', 'LEAST', 'GREATEST'] as const;

export const GET: RequestHandler = async ({ locals, url }) => {
  try {
    const ctx = await requireCoreCtx(locals);
    requireActor(ctx);
    const tableId = url.searchParams.get('tableId') ?? '';
    const caps = await requireCustomPropertyAccess(locals, ctx, tableId, 'view');
    const catalog = await loadFormulaCatalog(
      locals,
      ctx,
      tableId,
      await listCustomProperties(ctx, tableId),
    );
    return json({
      fields: catalog.fields,
      functions: FUNCTIONS,
      canManage: caps.canManage,
      revision: formulaCatalogRevision(
        catalog.definitions,
        catalog.fields.filter((field) => field.source === 'native'),
      ),
    });
  } catch (cause) {
    return propertyApiError(cause);
  }
};
