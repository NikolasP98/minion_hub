import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getOrCreateIdentity, signDeviceAuth } from '$server/services/device-identity.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    const ctx = await getCoreCtx(locals);
    if (!ctx) return json({ error: 'no tenant' }, { status: 401 });
    const body = await request.json();
    const { nonce, token, role, scopes, clientId, clientMode } = body as {
      nonce?: string;
      token?: string;
      role?: string;
      scopes?: string[];
      clientId?: string;
      clientMode?: string;
    };

    const identity = await getOrCreateIdentity(ctx);
    const device = signDeviceAuth(identity, {
      nonce: nonce ?? null,
      token: token ?? null,
      role,
      scopes,
      clientId,
      clientMode,
    });

    return json({ device });
  } catch (e) {
    console.error('[POST /api/device-identity/sign]', e);
    return json({ error: e instanceof Error ? e.message : 'sign failed' }, { status: 500 });
  }
};
