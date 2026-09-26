import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireCustomPropertyAccess } from '$server/services/custom-properties-access';
import {
  createCustomProperty,
  listCustomProperties,
} from '$server/services/custom-properties.service';
import {
  CUSTOM_PROPERTY_TABLE_IDS,
  customPropertyRulesSchema,
  type CreateCustomPropertyInput,
} from '$lib/tables/custom-properties';
import { propertyApiError, requireActor } from './api';

const createSchema = z
  .object({
    tableId: z.enum(CUSTOM_PROPERTY_TABLE_IDS),
    label: z.string(),
    description: z.string().nullable().optional(),
    rules: customPropertyRulesSchema,
    hasDefault: z.boolean(),
    defaultValue: z
      .union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null()])
      .optional(),
  })
  .strict();

export const GET: RequestHandler = async ({ locals, url }) => {
  try {
    const ctx = await requireCoreCtx(locals);
    requireActor(ctx);
    const tableId = url.searchParams.get('tableId');
    if (!tableId) throw error(400, 'table_id_required');
    const includeArchived = url.searchParams.get('includeArchived') === '1';
    const caps = await requireCustomPropertyAccess(
      locals,
      ctx,
      tableId,
      includeArchived ? 'manage' : 'view',
    );
    return json({
      definitions: await listCustomProperties(ctx, tableId, includeArchived),
      ...caps,
    });
  } catch (e) {
    return propertyApiError(e);
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    const ctx = await requireCoreCtx(locals);
    requireActor(ctx);
    const body = (await parseBody(request, createSchema)) as CreateCustomPropertyInput;
    await requireCustomPropertyAccess(locals, ctx, body.tableId, 'manage');
    return json({ definition: await createCustomProperty(ctx, body) }, { status: 201 });
  } catch (e) {
    return propertyApiError(e);
  }
};
