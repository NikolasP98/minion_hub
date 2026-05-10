import { createPaperclipClient, type PaperclipClient } from '@minion-stack/paperclip-client';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

export function paperclipServerClient(event: RequestEvent): PaperclipClient {
  const token = event.locals.paperclipIdentity?.token;
  if (!token) throw new Error('paperclipIdentity not populated by hooks');
  return createPaperclipClient({
    baseUrl: env.PAPERCLIP_INTERNAL_URL ?? 'http://paperclip:3200',
    fetch: globalThis.fetch,
    headers: { 'x-hub-identity': token },
  });
}
