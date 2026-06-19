// WhatsApp QR pairing RPC (split from gateway.svelte.ts).

import { sendRequest } from '../gateway-rpc';

export interface WhatsAppPairResult {
  ok: boolean;
  alreadyLinked?: boolean;
  message?: string;
}

/**
 * Request WhatsApp QR pairing from the gateway.
 *
 * The gateway starts a web login and pushes the QR as a `channels.whatsapp.qr`
 * event, then a terminal `channels.whatsapp.paired` / `channels.whatsapp.pairFailed`
 * event once the scan resolves. The response returned here reports whether the
 * login could be started (e.g. `alreadyLinked` when no QR is needed).
 *
 * `accountId` is optional — when omitted the gateway derives it from `channelId`
 * (`gw:whatsapp:<id>`), falling back to the default account for the `pending`
 * wizard sentinel.
 */
export async function requestWhatsAppPair(
  channelId: string,
  accountId?: string,
): Promise<WhatsAppPairResult> {
  const res = (await sendRequest('channels.whatsapp.pair', { channelId, accountId })) as
    | WhatsAppPairResult
    | undefined;
  return res ?? { ok: false, message: 'No response from gateway' };
}
