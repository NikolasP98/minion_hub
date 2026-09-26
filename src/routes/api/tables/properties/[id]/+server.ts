import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireCustomPropertyAccess } from '$server/services/custom-properties-access';
import {
  CustomPropertyError,
  getCustomProperty,
  listCustomProperties,
  setCustomPropertyArchived,
  updateCustomProperty,
} from '$server/services/custom-properties.service';
import {
  CUSTOM_PROPERTY_TABLE_IDS,
  customPropertyInputRulesSchema,
  type UpdateCustomPropertyInput,
} from '$lib/tables/custom-properties';
import { propertyApiError, requireActor } from '../api';
import { loadFormulaCatalog } from '$server/services/formula-properties.service';

const patchSchema = z
  .object({
    tableId: z.enum(CUSTOM_PROPERTY_TABLE_IDS),
    expectedVersion: z.number().int().positive(),
    action: z.literal('restore').optional(),
    label: z.string().optional(),
    description: z.string().nullable().optional(),
    rules: customPropertyInputRulesSchema.optional(),
    catalogRevision: z.string().optional(),
    hasDefault: z.boolean().optional(),
    defaultValue: z
      .union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null()])
      .optional(),
  })
  .strict();
const lifecycleSchema = z
  .object({
    tableId: z.enum(CUSTOM_PROPERTY_TABLE_IDS),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  try {
    const ctx = await requireCoreCtx(locals);
    requireActor(ctx);
    const body = await parseBody(request, patchSchema);
    await requireCustomPropertyAccess(locals, ctx, body.tableId, 'manage');
    if (!z.string().uuid().safeParse(params.id).success)
      throw new CustomPropertyError(404, 'property_unavailable');
    const definitions = await listCustomProperties(ctx, body.tableId, true);
    const catalog = await loadFormulaCatalog(locals, ctx, body.tableId, definitions);
    if (catalog.restrictedDefinitionIds.has(params.id))
      throw new CustomPropertyError(404, 'property_unavailable');
    const property = await getCustomProperty(ctx, params.id);
    if (property.tableId !== body.tableId)
      throw new CustomPropertyError(404, 'property_unavailable');
    const nativeSources = catalog.fields.filter((field) => field.source === 'native');
    const { catalogRevision, ...updateBody } = body;
    if (updateBody.rules?.type === 'formula' && !catalogRevision)
      throw new CustomPropertyError(409, 'catalog_changed');
    const definition =
      body.action === 'restore'
        ? await setCustomPropertyArchived(ctx, params.id, body.expectedVersion, false, {
            nativeSources: catalog.canonicalNativeSources,
          })
        : await updateCustomProperty(ctx, params.id, updateBody as UpdateCustomPropertyInput, {
            nativeSources: catalog.canonicalNativeSources,
            authorNativeSources: nativeSources,
            restrictedDefinitionIds: [...catalog.restrictedDefinitionIds],
            catalogRevision: updateBody.rules?.type === 'formula' ? catalogRevision : undefined,
          });
    return json({ definition });
  } catch (e) {
    return propertyApiError(e);
  }
};
export const DELETE: RequestHandler = async ({ locals, request, params }) => {
  try {
    const ctx = await requireCoreCtx(locals);
    requireActor(ctx);
    const body = await parseBody(request, lifecycleSchema);
    await requireCustomPropertyAccess(locals, ctx, body.tableId, 'manage');
    if (!z.string().uuid().safeParse(params.id).success)
      throw new CustomPropertyError(404, 'property_unavailable');
    const definitions = await listCustomProperties(ctx, body.tableId, true);
    const catalog = await loadFormulaCatalog(locals, ctx, body.tableId, definitions);
    if (catalog.restrictedDefinitionIds.has(params.id))
      throw new CustomPropertyError(404, 'property_unavailable');
    const property = await getCustomProperty(ctx, params.id);
    if (property.tableId !== body.tableId)
      throw new CustomPropertyError(404, 'property_unavailable');
    return json({
      definition: await setCustomPropertyArchived(ctx, params.id, body.expectedVersion, true, {
        nativeSources: catalog.canonicalNativeSources,
      }),
    });
  } catch (e) {
    return propertyApiError(e);
  }
};
