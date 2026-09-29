import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireCustomPropertyAccess } from '$server/services/custom-properties-access';
import {
  CustomPropertyError,
  createCustomProperty,
  listCustomProperties,
} from '$server/services/custom-properties.service';
import {
  CUSTOM_PROPERTY_TABLE_IDS,
  customPropertyInputRulesSchema,
  type CreateCustomPropertyInput,
} from '$lib/tables/custom-properties';
import { anyColumnPresentationSchema } from '$lib/tables/column-presentation';
import { propertyApiError, requireActor } from './api';
import { loadFormulaCatalog } from '$server/services/formula-properties.service';
import { projectCustomPropertyPresentations } from '$server/services/custom-property-presentation.service';
import { projectLegacyFormulaEditors } from '$server/services/formula-variable-legacy.service';

const createSchema = z
  .object({
    tableId: z.enum(CUSTOM_PROPERTY_TABLE_IDS),
    label: z.string(),
    description: z.string().nullable().optional(),
    rules: customPropertyInputRulesSchema,
    catalogRevision: z.string().optional(),
    presentation: anyColumnPresentationSchema.nullable().optional(),
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
    const allDefinitions = await listCustomProperties(ctx, tableId, includeArchived);
    const catalog = await loadFormulaCatalog(locals, ctx, tableId, allDefinitions);
    return json({
      definitions: caps.canManage
        ? projectLegacyFormulaEditors(
            catalog.definitions,
            allDefinitions,
            catalog.restrictedDefinitionIds,
            catalog.unavailableDefinitionIds,
          )
        : catalog.definitions,
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
    const parsed = await parseBody(request, createSchema);
    const { catalogRevision, ...body } = parsed as CreateCustomPropertyInput & {
      catalogRevision?: string;
    };
    await requireCustomPropertyAccess(locals, ctx, body.tableId, 'manage');
    const definitions = await listCustomProperties(ctx, body.tableId, true);
    const catalog = await loadFormulaCatalog(locals, ctx, body.tableId, definitions);
    const nativeSources = catalog.fields.filter((field) => field.source === 'native');
    if (body.rules.type === 'formula' && !catalogRevision)
      throw new CustomPropertyError(409, 'catalog_changed');
    const definition = await createCustomProperty(ctx, body, {
      nativeSources: catalog.canonicalNativeSources,
      authorNativeSources: nativeSources,
      restrictedDefinitionIds: [...catalog.restrictedDefinitionIds],
      unavailableDefinitionIds: [...catalog.unavailableDefinitionIds],
      catalogRevision: body.rules.type === 'formula' ? catalogRevision : undefined,
    });
    const refreshedDefinitions = await listCustomProperties(ctx, body.tableId, true);
    const responseCatalog = await loadFormulaCatalog(
      locals,
      ctx,
      body.tableId,
      refreshedDefinitions,
    );
    const projected = projectCustomPropertyPresentations(
      [definition],
      responseCatalog.restrictedDefinitionIds,
    );
    return json(
      {
        definition: projectLegacyFormulaEditors(
          projected,
          refreshedDefinitions,
          responseCatalog.restrictedDefinitionIds,
          responseCatalog.unavailableDefinitionIds,
        )[0],
      },
      { status: 201 },
    );
  } catch (e) {
    return propertyApiError(e);
  }
};
