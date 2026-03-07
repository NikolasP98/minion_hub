import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import {
  getProvisionConfig,
  upsertProvisionConfig,
  deleteProvisionConfig,
} from '$server/services/provision.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    const config = await getProvisionConfig(ctx, params.id!);
    if (!config) return json({ ok: true, config: null });

    // Redact API key — only indicate presence
    return json({
      ok: true,
      config: {
        ...config,
        apiKey: config.apiKey ? '••••••••' : null,
      },
    });
  } catch (e) {
    console.error(`[GET /api/servers/${params.id}/provision/config]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    const body = await request.json();
    const id = await upsertProvisionConfig(ctx, params.id!, body);
    return json({ ok: true, id });
  } catch (e) {
    console.error(`[PUT /api/servers/${params.id}/provision/config]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    await deleteProvisionConfig(ctx, params.id!);
    return json({ ok: true });
  } catch (e) {
    console.error(`[DELETE /api/servers/${params.id}/provision/config]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
