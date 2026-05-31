import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$server/db/client';
import { linkChannelIdentity } from '$server/services/channel-identity.service';

interface LinkPayload {
  ch: string;
  sid: string;
  exp: number;
}

function decodeCode(code: string): LinkPayload | null {
  try {
    const json = Buffer.from(code, 'base64url').toString('utf-8');
    const payload = JSON.parse(json) as LinkPayload;
    if (!payload.ch || !payload.sid || !payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const payload = decodeCode(params.code);
  if (!payload || Date.now() > payload.exp) {
    throw error(400, 'This link has expired. Send another message to the bot to get a new one.');
  }

  const channelLabel = payload.ch === 'whatsapp' ? 'WhatsApp' : payload.ch;
  const user = locals.user;

  if (!user) {
    // Not logged in — redirect to login with return URL
    const returnUrl = encodeURIComponent(`/link/${params.code}`);
    throw redirect(302, `/login?redirect=${returnUrl}`);
  }

  return {
    channel: payload.ch,
    channelLabel,
    channelUserId: payload.sid,
    userEmail: user.email ?? 'your account',
  };
};

export const actions: Actions = {
  default: async ({ params, locals, request }) => {
    const payload = decodeCode(params.code);
    if (!payload || Date.now() > payload.exp) {
      throw error(400, 'Link expired.');
    }

    const user = locals.user;
    if (!user) {
      throw error(401, 'You must be logged in.');
    }

    const tenantCtx = locals.tenantCtx;
    if (!tenantCtx) {
      throw error(500, 'No tenant context.');
    }

    await linkChannelIdentity(tenantCtx, {
      userId: user.id,
      channel: payload.ch,
      channelUserId: payload.sid,
    });

    return { success: true };
  },
};
