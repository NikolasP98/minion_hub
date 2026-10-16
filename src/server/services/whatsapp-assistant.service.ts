import { createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getPgClient } from '$server/db/pg-pool';
import { assertWhatsAppUserActive } from './whatsapp-member-authority';
import { inspectWhatsAppMember, rejectWhatsAppReadiness } from './whatsapp-readiness.service';
import type { TransactionSql } from 'postgres';

const PHONE = /^[1-9][0-9]{6,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Tx = TransactionSql;
type Body = Record<string, unknown>;
interface Account {
  id: string;
  tenant_id: string;
  gateway_id: string;
  provider_account_id: string;
  provider_account_verified_at: Date | null;
}
interface Turn {
  id: string;
  channel_id: string;
  org_id: string;
  profile_id: string;
  identity_id: string;
  claim_revision: string;
  sender_phone: string;
  sender_jid: string;
  provider_account_id: string;
  gateway_id: string;
  agent_id: string;
  session_key: string;
  run_id: string;
  lease_generation: string;
  owner_id: string;
  state: string;
}

function denied(): never {
  throw error(403, 'WhatsApp authority unavailable');
}
export function whatsappString(body: Body, key: string, max = 200): string {
  const value = body[key];
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value)
  )
    throw error(400, 'Invalid WhatsApp request');
  return value;
}
function generation(body: Body): number {
  const value = body.leaseGeneration ?? body.generation;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw error(400, 'Invalid lease generation');
  return value;
}
export function validateWhatsAppSender(body: Body): { phone: string; jid: string } {
  const phone = whatsappString(body, 'senderPhone', 15);
  const jid = whatsappString(body, 'senderJid', 100);
  if (!PHONE.test(phone) || jid !== `${phone}@s.whatsapp.net` || body.chatKind !== 'direct')
    denied();
  return { phone, jid };
}
function gatewayContext(locals: App.Locals): { serverId: string; orgId: string } {
  if (!locals.serverId || !locals.tenantCtx?.tenantId)
    throw error(401, 'Gateway authentication required');
  if (env.WHATSAPP_INTERNAL_ASSISTANT_ENABLED !== 'true')
    throw error(503, 'Internal WhatsApp assistant is disabled');
  return { serverId: locals.serverId, orgId: locals.tenantCtx.tenantId };
}
async function account(
  tx: Tx,
  locals: App.Locals,
  channelId: string,
  lockForVerify = false,
): Promise<Account> {
  const { serverId, orgId } = gatewayContext(locals);
  const gateways =
    await tx`select id,org_id from gateway where legacy_server_id=${serverId} or id::text=${serverId}`;
  if (gateways.length !== 1 || gateways[0].org_id !== orgId) denied();
  const rows = await tx<
    Account[]
  >`select c.id,c.tenant_id,c.gateway_id,c.provider_account_id,c.provider_account_verified_at
    from channels c where c.id=${channelId} and c.gateway_id=${gateways[0].id} and c.tenant_id=${orgId}
    and c.type='whatsapp' and c.owner_profile_id is null and c.enabled and c.replies='bound'
    and c.settings->>'assistantMode'='internal' and c.provider_account_id is not null ${lockForVerify ? tx`for update` : tx`for share`}`;
  if (rows.length !== 1) denied();
  return rows[0];
}
async function lease(tx: Tx, row: Account, owner: string, gen: number): Promise<void> {
  const rows = await tx`select channel_id from whatsapp_account_leases where channel_id=${row.id}
    and org_id=${row.tenant_id} and owner_id=${owner} and generation=${gen} and lease_until>clock_timestamp()
    and state='ready' and provider_verified_at is not null for share`;
  if (rows.length !== 1 || !row.provider_account_verified_at) denied();
}
async function currentIdentity(tx: Tx, phone: string, accountRow: Account) {
  const rows = await tx`select i.id,i.user_id,i.claim_revision,pa.agent_id from user_identities i
    join organization_members m on m.profile_id=i.user_id and m.organization_id=${accountRow.tenant_id}
    join personal_agents pa on pa.profile_id=i.user_id and pa.gateway_id=${accountRow.gateway_id} and pa.provisioning_status='active'
    where i.kind='channel' and i.provider='whatsapp' and i.external_id=${phone} and i.verified_at is not null for share of i,m,pa`;
  if (rows.length !== 1) denied();
  await assertWhatsAppUserActive(rows[0].user_id);
  return rows[0];
}
export async function whatsappLease(locals: App.Locals, body: Body) {
  const channelId = whatsappString(body, 'channelId');
  const owner = whatsappString(body, 'ownerId', 128);
  const operation = whatsappString(body, 'operation');
  return getPgClient().begin(async (tx) => {
    const row = await account(tx, locals, channelId, operation === 'verify');
    if (operation === 'acquire') {
      const providerId = whatsappString(body, 'providerAccountId', 15);
      if (providerId !== row.provider_account_id || !PHONE.test(providerId)) denied();
      const acquired =
        await tx`insert into whatsapp_account_leases(channel_id,org_id,owner_id,lease_until)
        values(${channelId},${row.tenant_id},${owner},clock_timestamp()+interval '60 seconds')
        on conflict(channel_id) do update set owner_id=excluded.owner_id,generation=whatsapp_account_leases.generation+1,
        lease_until=excluded.lease_until,heartbeat_at=clock_timestamp(),state='starting',provider_verified_at=null
        where whatsapp_account_leases.lease_until<=clock_timestamp() returning generation`;
      if (!acquired.length) throw error(409, 'Account already leased');
      // A process crash never grants permission to rerun an uncertain old model/action.
      await tx`update whatsapp_assistant_turns set state='reconcile_required',updated_at=clock_timestamp()
        where channel_id=${channelId} and state in ('admitted','running')`;
      return {
        generation: Number(acquired[0].generation),
        leaseMs: 60000,
        channelId,
        providerAccountId: row.provider_account_id,
      };
    }
    const gen = generation(body);
    const states = [
      'starting',
      'connecting',
      'ready',
      'reconnecting',
      'needs_relink',
      'stopped',
      'stale',
    ];
    const state =
      typeof body.state === 'string' && states.includes(body.state) ? body.state : 'connecting';
    if (operation === 'verify') {
      if (whatsappString(body, 'providerAccountId', 15) !== row.provider_account_id) denied();
    } else if (operation !== 'renew' && operation !== 'release')
      throw error(400, 'Invalid lease operation');
    const rows = await tx`update whatsapp_account_leases set heartbeat_at=clock_timestamp(),
      lease_until=case when ${operation}='release' then clock_timestamp() else clock_timestamp()+interval '60 seconds' end,
      state=${operation === 'verify' ? 'ready' : operation === 'release' ? 'stopped' : state},
      provider_verified_at=case when ${operation}='verify' then clock_timestamp() else provider_verified_at end
      where channel_id=${channelId} and owner_id=${owner} and generation=${gen} and lease_until>clock_timestamp() returning generation`;
    if (!rows.length) denied();
    if (operation === 'verify')
      await tx`update channels set provider_account_verified_at=clock_timestamp() where id=${channelId}`;
    return {
      ok: true,
      generation: gen,
      leaseMs: operation === 'release' ? 0 : 60000,
      channelId,
      providerAccountId: row.provider_account_id,
    };
  });
}
export async function admitWhatsApp(locals: App.Locals, body: Body) {
  const channelId = whatsappString(body, 'channelId');
  const owner = whatsappString(body, 'ownerId', 128);
  const messageId = whatsappString(body, 'providerMessageId', 200);
  const gen = generation(body);
  const { phone, jid } = validateWhatsAppSender(body);
  return getPgClient().begin(async (tx) => {
    const row = await account(tx, locals, channelId);
    await lease(tx, row, owner, gen);
    const identity = await currentIdentity(tx, phone, row);
    const readiness = await inspectWhatsAppMember(tx, {
      orgId: row.tenant_id,
      gatewayId: row.gateway_id,
      profileId: identity.user_id,
      agentId: identity.agent_id,
      channelId,
      activeProfileChecked: true,
    });
    if (!readiness.ready)
      rejectWhatsAppReadiness('Personal agent is not ready for WhatsApp', readiness);
    await lease(tx, row, owner, gen);
    // Rate limits contain no body and serialize at the claim/account, across Hub replicas.
    await tx`select pg_advisory_xact_lock(hashtextextended(${channelId + ':' + identity.user_id},0))`;
    const counts = await tx`select count(*)::int as n from whatsapp_assistant_turns
      where channel_id=${channelId} and profile_id=${identity.user_id} and created_at>clock_timestamp()-interval '1 minute'`;
    if (counts[0].n >= 30) throw error(429, 'WhatsApp admission rate exceeded');
    const sessionKey = `agent:${identity.agent_id}:whatsapp:${row.tenant_id}:${identity.user_id}:${channelId}`;
    const inserted = await tx<
      Turn[]
    >`insert into whatsapp_assistant_turns(channel_id,provider_message_id,org_id,profile_id,
      identity_id,claim_revision,sender_phone,sender_jid,provider_account_id,gateway_id,agent_id,session_key,lease_generation,owner_id)
      values(${channelId},${messageId},${row.tenant_id},${identity.user_id},${identity.id},${identity.claim_revision},${phone},${jid},
      ${row.provider_account_id},${row.gateway_id},${identity.agent_id},${sessionKey},${gen},${owner})
      on conflict(channel_id,provider_message_id) do nothing returning *`;
    if (!inserted.length) return { duplicate: true };
    const turn = inserted[0];
    return {
      admissionId: turn.id,
      duplicate: false,
      agentId: turn.agent_id,
      orgId: turn.org_id,
      profileId: turn.profile_id,
      sessionKey: turn.session_key,
      runId: turn.run_id,
    };
  });
}
async function checkedTurn(tx: Tx, locals: App.Locals, admissionId: string): Promise<Turn> {
  if (!UUID.test(admissionId)) throw error(400, 'Invalid admission');
  const rows = await tx<
    Turn[]
  >`select * from whatsapp_assistant_turns where id=${admissionId} for update`;
  if (!rows.length) denied();
  const turn = rows[0];
  const row = await account(tx, locals, turn.channel_id);
  await lease(tx, row, turn.owner_id, Number(turn.lease_generation));
  const identity = await currentIdentity(tx, turn.sender_phone, row);
  await lease(tx, row, turn.owner_id, Number(turn.lease_generation));
  if (
    identity.id !== turn.identity_id ||
    String(identity.claim_revision) !== String(turn.claim_revision) ||
    identity.user_id !== turn.profile_id ||
    identity.agent_id !== turn.agent_id ||
    row.provider_account_id !== turn.provider_account_id ||
    row.gateway_id !== turn.gateway_id ||
    row.tenant_id !== turn.org_id ||
    !['admitted', 'running', 'completed'].includes(turn.state)
  )
    denied();
  return turn;
}
/** Canonical guard called by the shared assistant principal resolver on every protected operation. */
export async function assertWhatsAppAdmission(locals: App.Locals, admissionId: string) {
  return getPgClient().begin(async (tx) => {
    const turn = await checkedTurn(tx, locals, admissionId);
    if (turn.state !== 'running') denied();
    return { principalId: turn.profile_id, orgId: turn.org_id, agentId: turn.agent_id };
  });
}
export async function whatsappTurn(locals: App.Locals, body: Body) {
  return getPgClient().begin(async (tx) => {
    const turn = await checkedTurn(tx, locals, whatsappString(body, 'admissionId'));
    if (
      turn.owner_id !== whatsappString(body, 'ownerId') ||
      Number(turn.lease_generation) !== generation(body)
    )
      denied();
    const operation = whatsappString(body, 'operation');
    const next =
      operation === 'start'
        ? 'running'
        : operation === 'complete'
          ? 'completed'
          : operation === 'reconcile'
            ? 'reconcile_required'
            : operation === 'fail'
              ? 'failed'
              : null;
    if (!next) throw error(400, 'Invalid turn operation');
    const previous = operation === 'start' ? 'admitted' : 'running';
    const updated =
      await tx`update whatsapp_assistant_turns set state=${next},updated_at=clock_timestamp() where id=${turn.id} and (state=${previous} or (${operation}='fail' and state='admitted')) returning id`;
    if (!updated.length) throw error(409, 'Turn already claimed or settled');
    return { ok: true };
  });
}
export async function whatsappReply(locals: App.Locals, body: Body) {
  return getPgClient().begin(async (tx) => {
    const turn = await checkedTurn(tx, locals, whatsappString(body, 'admissionId'));
    if (
      turn.owner_id !== whatsappString(body, 'ownerId') ||
      Number(turn.lease_generation) !== generation(body)
    )
      denied();
    const part = body.replyPart;
    if (typeof part !== 'number' || !Number.isInteger(part) || part < 0 || part > 99)
      throw error(400, 'Invalid reply part');
    const operation = whatsappString(body, 'operation');
    if (operation === 'prepare') {
      if (typeof body.text !== 'string' || !body.text.length || body.text.length > 16000)
        throw error(400, 'Invalid reply');
      const hash = createHash('sha256').update(body.text).digest('hex');
      const rows =
        await tx`insert into whatsapp_assistant_replies(turn_id,org_id,reply_part,body,content_hash)
        values(${turn.id},${turn.org_id},${part},${body.text},${hash})
        on conflict(turn_id,reply_part) do update set content_hash=whatsapp_assistant_replies.content_hash
        where whatsapp_assistant_replies.content_hash=excluded.content_hash returning id,state`;
      if (!rows.length || rows[0].state !== 'pending')
        throw error(409, 'Reply already claimed or changed');
      return { ok: true, replyId: rows[0].id };
    }
    const next =
      operation === 'sending'
        ? 'sending'
        : operation === 'confirmed'
          ? 'confirmed'
          : operation === 'unknown'
            ? 'unknown'
            : null;
    if (!next) throw error(400, 'Invalid reply operation');
    const providerId = operation === 'confirmed' ? whatsappString(body, 'providerMessageId') : null;
    const rows =
      await tx`update whatsapp_assistant_replies set state=${next},provider_message_id=${providerId},updated_at=clock_timestamp()
      where turn_id=${turn.id} and reply_part=${part} and state=${next === 'sending' ? 'pending' : 'sending'} returning id`;
    if (!rows.length) throw error(409, 'Reply already claimed or settled');
    return { ok: true, replyId: rows[0].id };
  });
}

// TODO(handoff): Couple local business mutations and receipts in their domain transaction;
// prepared external outcomes require operator reconciliation, never automatic replay.
// See meta proposals/2026-10-16-internal-whatsapp-personal-assistant.md.
export async function whatsappEffect(locals: App.Locals, body: Body) {
  const actionId = whatsappString(body, 'actionId', 200);
  const hash = whatsappString(body, 'argsHash', 64);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw error(400, 'Invalid action hash');
  return getPgClient().begin(async (tx) => {
    const turn = await checkedTurn(tx, locals, whatsappString(body, 'admissionId'));
    if (turn.state !== 'running') denied();
    const operation = whatsappString(body, 'operation');
    if (operation === 'prepare') {
      // The turn row lock serializes claims. An unsettled receipt may represent
      // an executed action whose response was lost, so a new call ID cannot retry it.
      const unsettled = await tx`select id from assistant_action_receipts
        where turn_id=${turn.id} and state in ('prepared','unknown') limit 1`;
      if (unsettled.length) throw error(409, 'Earlier action requires settlement');
      const rows =
        await tx`insert into assistant_action_receipts(principal_id,org_id,turn_id,action_id,args_hash)
        values(${turn.profile_id},${turn.org_id},${turn.id},${actionId},${hash}) on conflict do nothing returning id`;
      if (!rows.length) throw error(409, 'Action already claimed');
      return { ok: true };
    }
    if (operation !== 'committed' && operation !== 'unknown')
      throw error(400, 'Invalid action operation');
    // A committed receipt acknowledgment may be lost on its way to the worker.
    // Preserve the known commit, but fence the turn when the worker reports uncertainty.
    const rows = await tx`update assistant_action_receipts
      set state=case when state='committed' then state else ${operation} end,updated_at=now()
      where turn_id=${turn.id} and action_id=${actionId} and args_hash=${hash}
      and (state='prepared' or (${operation === 'unknown'} and state='committed')) returning id`;
    if (!rows.length) throw error(409, 'Action already settled or changed');
    if (operation === 'unknown')
      await tx`update whatsapp_assistant_turns set state='reconcile_required',updated_at=now() where id=${turn.id}`;
    return { ok: true };
  });
}

export async function whatsappConfirmation(locals: App.Locals, body: Body) {
  const actionName = whatsappString(body, 'actionName', 200);
  const hash = whatsappString(body, 'argsHash', 64);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw error(400, 'Invalid action hash');
  return getPgClient().begin(async (tx) => {
    const turn = await checkedTurn(tx, locals, whatsappString(body, 'admissionId'));
    if (turn.state !== 'running') denied();
    const operation = whatsappString(body, 'operation');
    await tx`select pg_advisory_xact_lock(hashtextextended(${turn.session_key},0))`;
    if (operation === 'preview') {
      await tx`update whatsapp_assistant_confirmations set consumed_at=now()
        where session_key=${turn.session_key} and consumed_at is null and expires_at<=now()`;
      const rows =
        await tx`insert into whatsapp_assistant_confirmations(org_id,profile_id,channel_id,identity_id,claim_revision,session_key,preview_turn_id,action_name,args_hash)
        values(${turn.org_id},${turn.profile_id},${turn.channel_id},${turn.identity_id},${turn.claim_revision},${turn.session_key},${turn.id},${actionName},${hash})
        on conflict(session_key) where consumed_at is null do update set args_hash=whatsapp_assistant_confirmations.args_hash
        where whatsapp_assistant_confirmations.args_hash=excluded.args_hash and whatsapp_assistant_confirmations.action_name=excluded.action_name
        and whatsapp_assistant_confirmations.preview_turn_id=excluded.preview_turn_id returning id`;
      if (!rows.length) throw error(409, 'A different confirmation is pending');
      return { ok: true };
    }
    if (operation !== 'consume') throw error(400, 'Invalid confirmation operation');
    const inputText = whatsappString(body, 'inputText', 100).trim();
    if (!/^(yes|confirm|si|sí|confirmo|adelante)[.!]?$/i.test(inputText))
      throw error(409, 'Explicit confirmation required');
    const rows =
      await tx`update whatsapp_assistant_confirmations set consumed_at=now() where session_key=${turn.session_key}
      and org_id=${turn.org_id} and profile_id=${turn.profile_id} and channel_id=${turn.channel_id}
      and identity_id=${turn.identity_id} and claim_revision=${turn.claim_revision}
      and action_name=${actionName} and args_hash=${hash} and preview_turn_id<>${turn.id}
      and expires_at>now() and consumed_at is null
      and exists(select 1 from whatsapp_assistant_turns preview where preview.id=preview_turn_id and preview.state='completed')
      and exists(select 1 from whatsapp_assistant_replies r where r.turn_id=preview_turn_id and r.state='confirmed') returning id`;
    if (!rows.length) throw error(409, 'Confirmation unavailable or changed');
    return { ok: true };
  });
}
