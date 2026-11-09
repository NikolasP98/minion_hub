import {
  apiReadCapability,
  hasOrgCapability,
  ownerFilter,
  shouldMaskSensitive,
} from '$server/services/rbac.service';
import type { PartyReadScope } from '$server/services/party.service';

/** CRM restrictions remain a floor; unrelated customer/supplier consumers keep their shared spine. */
export async function partyReadScope(locals: App.Locals): Promise<PartyReadScope> {
  if (!(await hasOrgCapability(locals, 'crm', 'view'))) return {};
  const [ownerId, maskSensitive] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
  ]);
  const alternatives = apiReadCapability('/api/crm/parties')?.anyOf ?? [];
  const allowUnlinked = ownerId
    ? (
        await Promise.all(
          alternatives.map(({ module, action }) => hasOrgCapability(locals, module, action)),
        )
      ).some(Boolean)
    : false;
  return {
    ...(ownerId ? { ownerId, allowUnlinked } : {}),
    ...(maskSensitive ? { maskSensitive: true } : {}),
  };
}
