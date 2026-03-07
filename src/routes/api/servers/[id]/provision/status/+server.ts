import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import {
  getProvisionConfig,
  checkPhaseStatus,
  savePhaseStatuses,
} from '$server/services/provision.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    const config = await getProvisionConfig(ctx, params.id!);
    if (!config?.sshHost) {
      return json(
        { ok: false, error: 'No SSH host configured for this server' },
        { status: 400 },
      );
    }

    const phases = await checkPhaseStatus({
      sshHost: config.sshHost,
      sshUser: config.sshUser ?? 'root',
      sshPort: config.sshPort ?? 22,
      agentName: config.agentName ?? undefined,
      gatewayPort: config.gatewayPort ?? 18789,
    });

    // Persist results
    await savePhaseStatuses(ctx, params.id!, phases);

    return json({ ok: true, phases });
  } catch (e) {
    console.error(`[GET /api/servers/${params.id}/provision/status]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
