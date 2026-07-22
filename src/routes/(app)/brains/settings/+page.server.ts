import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import {
  getBrainEnrichmentPlatformState,
  getBrainEnrichmentSettingsState,
  listBrainEnrichmentAdapterIds,
  listBrainEnrichmentModelCatalog,
} from '$server/services/brain-enrichment-settings.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  await requireOrgCapability(locals, 'brains', 'manage');
  const ctx = await requireCoreCtx(locals);
  depends('brains:settings');
  return {
    enrichment: await getBrainEnrichmentSettingsState(ctx),
    platform: getBrainEnrichmentPlatformState(),
    modelCatalog: listBrainEnrichmentModelCatalog(),
    adapterIds: listBrainEnrichmentAdapterIds(),
  };
};
