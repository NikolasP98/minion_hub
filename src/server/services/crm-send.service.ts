import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { gatewayCall } from '$lib/server/gateway-rpc';
import { insertMessages, type IngestRow } from './messages.service';

/** Build the outbound ledger row for a CRM-sent message. Pure → testable. */
export function buildOutboundRow(args: {
  contactId: string;
  channel: string;
  to: string;
  accountId: string | null;
  text: string;
  occurredAt: number;
  clientId?: string;
}): IngestRow {
  return {
    // channels.send does NOT record to the ledger, so this row is the single
    // source of truth for the bubble. The clientId is supplied by the UI so its
    // optimistic bubble and this row share one identity (dedup, no flicker).
    clientId: args.clientId ?? `crm-send:${args.contactId}:${args.occurredAt}`,
    direction: 'outbound',
    channel: args.channel,
    accountId: args.accountId,
    chatId: args.to,
    isGroup: false,
    senderId: args.accountId,
    senderName: null,
    senderHandle: null,
    isBot: false,
    content: args.text,
    messageId: null,
    agentId: null,
    sessionKey: null,
    success: true,
    error: null,
    occurredAt: args.occurredAt,
    metadata: { source: 'crm-compose' },
  };
}

/**
 * Send a message to a contact from the CRM detail page.
 * Resolves the recipient + originating account from the contact's identity and
 * existing thread, dispatches via the gateway, and records the outbound row so
 * it appears in the timeline immediately.
 */
export async function sendContactMessage(
  ctx: CoreCtx,
  contactId: string,
  channel: string,
  text: string,
  clientId?: string,
): Promise<{ ok: true }> {
  const body = text.trim();
  if (!body) throw new Error('Message text is required');

  // Recipient + originating account resolved together in one round-trip.
  const resolved = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select i.external_id as to,
             m.account_id  as account_id,
             m.gateway_id  as gateway_id
      from crm_contact_identities i
      left join lateral (
        select account_id, gateway_id from messages
        where org_id = ${ctx.tenantId} and channel = ${channel} and chat_id = i.external_id
        order by occurred_at desc nulls last limit 1
      ) m on true
      where i.contact_id = ${contactId} and i.channel = ${channel}
      limit 1
    `),
  )) as unknown as Array<{ to: string; account_id: string | null; gateway_id: string | null }>;

  const to = resolved[0]?.to;
  if (!to) throw new Error(`Contact has no ${channel} identity`);
  const accountId = resolved[0]?.account_id ?? null;
  const gatewayId = resolved[0]?.gateway_id ?? null;

  await gatewayCall('channels.send', {
    channel,
    to,
    text: body,
    ...(accountId ? { accountId } : {}),
    idempotencyKey: clientId ?? randomUUID(),
  });

  await insertMessages(ctx.tenantId, gatewayId, [
    buildOutboundRow({ contactId, channel, to, accountId, text: body, occurredAt: Date.now(), clientId }),
  ]);

  return { ok: true };
}
