import type { PageServerLoad } from './$types';
import { requireDataset } from '$server/auth/dataset-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import {
  getBrainEnrichmentPlatformState,
  getBrainEnrichmentSettingsState,
  listBrainEnrichmentAdapterIds,
  listBrainEnrichmentModelCatalog,
} from '$server/services/brain-enrichment-settings.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  await requireOrgCapability(locals, 'brains', 'manage');
  const ctx = await requireDataset(locals, 'brains');
  depends('brains:settings');
  return {
    enrichment: await getBrainEnrichmentSettingsState(ctx),
    platform: getBrainEnrichmentPlatformState(),
    modelCatalog: listBrainEnrichmentModelCatalog(),
    adapterIds: listBrainEnrichmentAdapterIds(),
  };
};
