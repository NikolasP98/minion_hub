import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { parseBody } from '$server/api/validate';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import {
  brainEnrichmentSettingsInputSchema,
  getBrainEnrichmentPlatformState,
  getBrainEnrichmentSettingsState,
  listBrainEnrichmentAdapterIds,
  listBrainEnrichmentModelCatalog,
  updateBrainEnrichmentConfig,
} from '$server/services/brain-enrichment-settings.service';

export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'brains', 'manage');
  const ctx = await requireCoreCtx(locals);
  return json({
    enrichment: await getBrainEnrichmentSettingsState(ctx),
    platform: getBrainEnrichmentPlatformState(),
    modelCatalog: listBrainEnrichmentModelCatalog(),
    adapterIds: listBrainEnrichmentAdapterIds(),
  });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  const capabilities = await requireOrgCapability(locals, 'brains', 'manage');
  if (capabilities && !capabilities.roles.some((role) => role === 'owner' || role === 'admin')) {
    throw error(403, 'Owner or administrator access required');
  }
  const ctx = await requireCoreCtx(locals);
  const body = await parseBody(request, brainEnrichmentSettingsInputSchema);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  const configured = await updateBrainEnrichmentConfig(ctx, body, actor);
  return json({
    enrichment: {
      configured,
      effective: configured,
      status: 'valid',
      reasons: [],
    },
    platform: getBrainEnrichmentPlatformState(),
  });
};
