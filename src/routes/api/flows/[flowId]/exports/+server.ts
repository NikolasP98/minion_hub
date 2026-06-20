import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getMasterFlow, flowExportedSpecs } from '$lib/flows/master-flows';
import { setExportToggle } from '$lib/server/flows/exports-store';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);

  const body = await request.json();
  const { varKey, enabled } = body as { varKey?: unknown; enabled?: unknown };

  // Validate that varKey and enabled are provided and correct types
  if (typeof varKey !== 'string' || varKey === '') {
    throw error(400, 'Missing or invalid varKey');
  }

  if (typeof enabled !== 'boolean') {
    throw error(400, 'Missing or invalid enabled (must be boolean)');
  }

  // Validate that the flow exists
  const flow = getMasterFlow(params.flowId!);
  if (!flow) {
    throw error(404, 'Flow not found');
  }

  // Validate that varKey belongs to the flow's declared specs
  const specs = flowExportedSpecs(flow);
  if (!specs.some((s) => s.key === varKey)) {
    throw error(400, `Unknown varKey "${varKey}" for this flow`);
  }

  // Set the export toggle
  await setExportToggle(ctx, params.flowId!, varKey, enabled);

  return json({ ok: true });
};
