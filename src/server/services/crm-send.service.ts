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
}): IngestRow {
  return {
    // Deterministic-ish id; channels.send does NOT record to the ledger, so this
    // row is the single source of truth for the bubble (no dedup collision).
    clientId: `crm-send:${args.contactId}:${args.occurredAt}`,
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
): Promise<{ ok: true }> {
  const body = text.trim();
  if (!body) throw new Error('Message text is required');

  const { to, accountId, gatewayId } = await withOrgCore(ctx, async (tx) => {
    const ident = (await tx.execute(sql`
      select external_id from crm_contact_identities
      where contact_id = ${contactId} and channel = ${channel}
      limit 1
    `)) as unknown as Array<{ external_id: string }>;
    const to = ident[0]?.external_id;
    if (!to) throw new Error(`Contact has no ${channel} identity`);
    // Originate from the same account the thread is already on (FACES has >1 WA acct).
    const last = (await tx.execute(sql`
      select account_id, gateway_id from messages
      where org_id = ${ctx.tenantId} and channel = ${channel} and chat_id = ${to}
      order by occurred_at desc nulls last limit 1
    `)) as unknown as Array<{ account_id: string | null; gateway_id: string | null }>;
    return { to, accountId: last[0]?.account_id ?? null, gatewayId: last[0]?.gateway_id ?? null };
  });

  await gatewayCall('channels.send', {
    channel,
    to,
    text: body,
    ...(accountId ? { accountId } : {}),
    idempotencyKey: randomUUID(),
  });

  await insertMessages(ctx.tenantId, gatewayId, [
    buildOutboundRow({ contactId, channel, to, accountId, text: body, occurredAt: Date.now() }),
  ]);

  return { ok: true };
}
