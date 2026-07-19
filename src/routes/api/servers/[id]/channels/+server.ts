import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listChannels, createChannel, isValidChannelType } from '$server/services/channel.service';
import { getServerCtx } from '$server/auth/core-ctx';
import { publishChannel } from '$server/services/channel-publish.service';
import { requireOrgCapability } from '$server/services/rbac.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) throw error(401);
  try {
    const items = await listChannels(ctx);
    return json({ channels: items });
  } catch (e) {
    console.error(`[GET /api/servers/${params.id}/channels]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) throw error(401);
  await requireOrgCapability(locals, 'channels', 'create');

  try {
    const body = await request.json();
    if (!body.type || !body.label) throw error(400, 'type and label required');
    if (!isValidChannelType(body.type)) throw error(400, `Invalid channel type: ${body.type}`);

    // Access rules (Phase 4: DB-authoritative — the wizard collects these instead of
    // writing dmPolicy/allowFrom into gateway.json). Validated the same way the PUT
    // route validates them.
    if (body.replies !== undefined && body.replies !== 'none' && body.replies !== 'bound') {
      throw error(400, `Invalid replies: ${body.replies} (expected 'none' | 'bound')`);
    }
    if (
      body.allowFrom !== undefined &&
      (!Array.isArray(body.allowFrom) || body.allowFrom.some((x: unknown) => typeof x !== 'string'))
    ) {
      throw error(400, 'allowFrom must be a string[]');
    }

    const id = await createChannel(ctx, {
      type: body.type,
      label: body.label,
      accountId: typeof body.accountId === 'string' && body.accountId.trim() ? body.accountId.trim() : undefined,
      credentials: body.credentials,
      credentialsMeta: body.credentialsMeta,
      status: body.status,
      replies: body.replies,
      allowFrom: body.allowFrom,
      // Personal intent ⇒ user-scoped account. Derived from the SESSION — an
      // `ownerProfileId` in the body is ignored, else one user could claim another's.
      ownerProfileId: body.personal === true ? ctx.profileId : undefined,
    });

    // Mirror the row to the gateway (self-gates to migrated, account-keyed types —
    // a no-op for rows created without an accountId yet). Fire-and-forget, matching
    // the PUT route's pattern.
    void publishChannel(ctx, id);

    return json({ ok: true, id });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    console.error(`[POST /api/servers/${params.id}/channels]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
