import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireCustomPropertyAccess } from '$server/services/custom-properties-access';
import { authorizeCustomPropertyRecords } from '$server/services/custom-property-entities.service';
import { putCustomPropertyValue } from '$server/services/custom-properties.service';
import { propertyApiError, requireActor } from '../api';
import { CUSTOM_PROPERTY_TABLE_IDS } from '$lib/tables/custom-properties';

const putSchema = z
  .object({
    tableId: z.enum(CUSTOM_PROPERTY_TABLE_IDS),
    propertyId: z.string().uuid(),
    recordId: z.string().min(1).max(500),
    value: z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null()]),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export const PUT: RequestHandler = async ({ locals, request }) => {
  try {
    const ctx = await requireCoreCtx(locals);
    requireActor(ctx);
    const body = await parseBody(request, putSchema);
    await requireCustomPropertyAccess(locals, ctx, body.tableId, 'edit');
    const access = await authorizeCustomPropertyRecords(
      locals,
      ctx,
      body.tableId,
      [body.recordId],
      'edit',
    );
    if (!access[body.recordId]?.canEdit) throw error(404, 'record_unavailable');
    return json({
      cell: await putCustomPropertyValue(
        ctx,
        body.tableId,
        body.propertyId,
        body.recordId,
        body.value,
        body.expectedVersion,
      ),
    });
  } catch (e) {
    return propertyApiError(e);
  }
};
