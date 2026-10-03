import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { resolveWalletIdentityForAdmission } from '$server/services/pos/wallet-identity';
import { handlePosError } from '../../_errors';

const querySchema = z
	.object({
		partyId: z.string().uuid().nullable().optional(),
		crmContactId: z.string().uuid().nullable().optional(),
	})
	.refine((value) => Boolean(value.partyId || value.crmContactId), {
		message: 'partyId or crmContactId is required',
	});

/** Freeze the canonical wallet identity before the browser creates durable plan admission. */
export const GET: RequestHandler = async ({ locals, url }) => {
	const ctx = await getCoreCtx(locals);
	if (!ctx) throw error(401);
	if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
	await requireOrgCapability(locals, 'pos', 'create');
	const parsed = querySchema.safeParse({
		partyId: url.searchParams.get('partyId'),
		crmContactId: url.searchParams.get('crmContactId'),
	});
	if (!parsed.success) throw error(400, 'invalid wallet identity');
	try {
		const identity = await resolveWalletIdentityForAdmission(ctx, parsed.data);
		return json(identity, { headers: { 'cache-control': 'private, no-store' } });
	} catch (failure) {
		return handlePosError(failure);
	}
};
