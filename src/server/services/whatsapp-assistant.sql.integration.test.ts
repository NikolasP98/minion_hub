import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { importPersonalMemory, validatePersonalMemoryExport } from './canonical-memory-import';
import { canonicalAgentMemory } from './canonical-agent-memory.service';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';
const mocks = vi.hoisted(() => ({
  pg: vi.fn(),
  embedOn: false,
  embed: vi.fn(),
  user: vi.fn(),
  env: {
    WHATSAPP_INTERNAL_ASSISTANT_ENABLED: 'true',
    ENCRYPTION_KEY: 'local-test-secret-never-production',
  },
}));
vi.mock('$server/services/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./embeddings')>();
  return { ...actual, embeddingsEnabled: () => mocks.embedOn, embedText: mocks.embed };
});
vi.mock('$server/db/pg-pool', () => ({ getPgClient: mocks.pg }));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({ auth: { admin: { getUserById: mocks.user } } }),
}));
vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
import {
  admitWhatsApp,
  whatsappLease,
  whatsappTurn,
  whatsappReply,
  whatsappEffect,
  whatsappConfirmation,
  assertWhatsAppAdmission,
} from './whatsapp-assistant.service';
import { requestOtpClaim, verifyOtpClaim } from '$server/identity/channel-claim.service';
const ORG = '10000000-0000-4000-8000-000000000001',
  OTHER = '10000000-0000-4000-8000-000000000002';
const USER = '20000000-0000-4000-8000-000000000001',
  GATEWAY = '30000000-0000-4000-8000-000000000001';
const schema = `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`;
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let db: ReturnType<typeof postgres>;
let servicePool: ReturnType<typeof postgres>;
const locals = { serverId: GATEWAY, tenantCtx: { tenantId: ORG, db: {} as never } } as App.Locals;
const leaseBase = { channelId: 'wa-test', ownerId: 'worker-a', providerAccountId: '19995550101' };
const admitBase = {
  ...leaseBase,
  leaseGeneration: 1,
  providerMessageId: 'msg-1',
  senderPhone: '19995550102',
  senderJid: '19995550102@s.whatsapp.net',
  chatKind: 'direct',
};
async function ready() {
  await whatsappLease(locals, { ...leaseBase, operation: 'acquire' });
  await whatsappLease(locals, { ...leaseBase, operation: 'verify', generation: 1 });
}
async function start() {
  await ready();
  const admitted = await admitWhatsApp(locals, admitBase);
  if (!admitted.admissionId) throw Error('not admitted');
  await whatsappTurn(locals, {
    ...admitBase,
    admissionId: admitted.admissionId,
    operation: 'start',
  });
  return admitted.admissionId;
}
beforeAll(async () => {
  harness = await openDisposablePostgres();
  await harness.owner.unsafe(
    `create schema ${schema}; grant usage on schema ${schema} to authenticated,anon,service_role`,
  );
  db = harness.createConnection(schema);
  servicePool = postgres(process.env.MINION_QC_DATABASE_URL!, {
    max: 6,
    prepare: false,
    onnotice: () => {},
    connection: { search_path: `${schema},pg_catalog`, statement_timeout: 15000 },
  });
  mocks.pg.mockReturnValue(servicePool);
  const baseline = readFileSync('supabase/qa/baseline/schema.sql', 'utf8');
  for (const table of [
    'gateway',
    'channels',
    'profiles',
    'user_identities',
    'organization_members',
    'personal_agents',
    'agent_memories',
  ]) {
    const ddl = baseline.match(
      new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`),
    )?.[0];
    if (!ddl) throw Error(table);
    await db.unsafe(
      ddl
        .replace('public.vector', '__VECTOR_TYPE__')
        .replaceAll('public.', `${schema}.`)
        .replace('__VECTOR_TYPE__', 'public.vector'),
    );
  }
  await db`create unique index agent_memories_source_uniq on agent_memories(org_id,source,source_id) where source_id is not null`;
  await db`alter table channels add primary key(id)`;
  await db`alter table profiles add primary key(id)`;
  await db`alter table user_identities add unique(provider,external_id)`;
  await db.unsafe(
    readFileSync(
      'supabase/migrations/20260610180600_pending_channel_claims.sql',
      'utf8',
    ).replaceAll('public.', `${schema}.`),
  );
  await db.unsafe(
    readFileSync('supabase/migrations/20261016120000_internal_whatsapp.sql', 'utf8')
      .replaceAll('public.', `${schema}.`)
      .replaceAll('search_path=public', `search_path=${schema}`),
  );
}, 30000);
afterAll(async () => {
  if (!harness) return;
  await servicePool?.end();
  await harness.owner.unsafe(`drop schema if exists ${schema} cascade`);
  await harness.close();
});
beforeEach(async () => {
  await db`truncate assistant_action_receipts,whatsapp_assistant_replies,whatsapp_assistant_turns,whatsapp_account_leases,pending_channel_claims,user_identities,organization_members,personal_agents,channels,gateway,profiles cascade`;
  await db`truncate agent_memories,agent_memory_tombstones`;
  mocks.embedOn = false;
  mocks.env.WHATSAPP_INTERNAL_ASSISTANT_ENABLED = 'true';
  mocks.user.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  await db`insert into gateway(id,org_id,name,url) values(${GATEWAY},${ORG},'test','http://127.0.0.1')`;
  await db`insert into channels(id,tenant_id,gateway_id,type,label,enabled,replies,account_id,auth_ref,provider_account_id,settings)
 values('wa-test',${ORG},${GATEWAY},'whatsapp','test',true,'bound','test','whatsapp/test','19995550101','{"assistantMode":"internal"}')`;
  await db`insert into profiles(id,email) values(${USER},'whatsapp-fixture@example.invalid')`;
  await db`insert into organization_members(organization_id,profile_id,role) values(${ORG},${USER},'member')`;
  await db`insert into personal_agents(id,profile_id,agent_id,gateway_id,display_name,provisioning_status) values('pa-test',${USER},'personal-test',${GATEWAY},'test','active')`;
  await db`insert into user_identities(user_id,provider,kind,external_id,verified_at) values(${USER},'whatsapp','channel','19995550102',1)`;
});
describe('WhatsApp native PostgreSQL authority', () => {
  it('rejects global number and auth-store duplicates, accepts multiple accounts in one org', async () => {
    await expect(
      db`insert into channels(id,tenant_id,gateway_id,type,label,provider_account_id) values('duplicate',${OTHER},${GATEWAY},'whatsapp','other','19995550101')`,
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db`insert into channels(id,tenant_id,gateway_id,type,label,auth_ref) values('duplicate',${OTHER},${GATEWAY},'whatsapp','other','whatsapp/test')`,
    ).rejects.toMatchObject({ code: '23505' });
    await db`insert into channels(id,tenant_id,gateway_id,type,label,provider_account_id) values('second',${ORG},${GATEWAY},'whatsapp','other','19995550103')`;
    expect((await db`select id from channels`).length).toBe(2);
  });
  it('fences competing workers and stale generations, requires verified socket before admission', async () => {
    await whatsappLease(locals, { ...leaseBase, operation: 'acquire' });
    await expect(admitWhatsApp(locals, admitBase)).rejects.toMatchObject({ status: 403 });
    await expect(
      whatsappLease(locals, { ...leaseBase, ownerId: 'worker-b', operation: 'acquire' }),
    ).rejects.toMatchObject({ status: 409 });
    await Promise.all([
      whatsappLease(locals, { ...leaseBase, operation: 'verify', generation: 1 }),
      whatsappLease(locals, {
        ...leaseBase,
        operation: 'renew',
        generation: 1,
        state: 'connecting',
      }),
    ]);
    await whatsappLease(locals, { ...leaseBase, operation: 'verify', generation: 1 });
    await expect(admitWhatsApp(locals, { ...admitBase, leaseGeneration: 2 })).rejects.toMatchObject(
      { status: 403 },
    );
  });
  it('admits once and retains continuous history across original-message duplicates', async () => {
    await ready();
    const first = await admitWhatsApp(locals, admitBase);
    const duplicate = await admitWhatsApp(locals, admitBase);
    expect(duplicate).toEqual({ duplicate: true });
    const second = await admitWhatsApp(locals, { ...admitBase, providerMessageId: 'msg-2' });
    expect(first).toMatchObject({ agentId: 'personal-test', profileId: USER, orgId: ORG });
    expect(
      'sessionKey' in first && 'sessionKey' in second && first.sessionKey === second.sessionKey,
    ).toBe(true);
    expect((await db`select id from whatsapp_assistant_turns`).length).toBe(2);
  });
  it('rejects opaque LID, group, unknown phone and disabled GoTrue user without retained turns', async () => {
    await ready();
    for (const input of [
      { senderJid: '19995550102@lid' },
      { chatKind: 'group' },
      { senderPhone: '19995550109', senderJid: '19995550109@s.whatsapp.net' },
    ])
      await expect(admitWhatsApp(locals, { ...admitBase, ...input })).rejects.toMatchObject({
        status: 403,
      });
    mocks.user.mockResolvedValue({
      data: { user: { id: USER, banned_until: '2099-01-01' } },
      error: null,
    });
    await expect(admitWhatsApp(locals, admitBase)).rejects.toMatchObject({ status: 403 });
    expect((await db`select id from whatsapp_assistant_turns`).length).toBe(0);
  });
  it('rechecks claim revision, membership and account stop before every operation', async () => {
    const id = await start();
    await expect(assertWhatsAppAdmission(locals, id)).resolves.toMatchObject({ principalId: USER });
    await db`update user_identities set verified_at=2 where user_id=${USER}`;
    await expect(assertWhatsAppAdmission(locals, id)).rejects.toMatchObject({ status: 403 });
  });
  it('stops queued replies on membership revocation and never reclaims uncertain send', async () => {
    const admissionId = await start();
    const reply = { ...admitBase, admissionId, replyPart: 0 };
    await whatsappReply(locals, { ...reply, operation: 'prepare', text: 'hello' });
    await whatsappReply(locals, { ...reply, operation: 'sending' });
    await whatsappReply(locals, { ...reply, operation: 'unknown' });
    await expect(whatsappReply(locals, { ...reply, operation: 'sending' })).rejects.toMatchObject({
      status: 409,
    });
    await db`delete from organization_members where profile_id=${USER}`;
    await expect(
      whatsappReply(locals, { ...reply, operation: 'prepare', replyPart: 1, text: 'secret' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('claims each tool effect once even after unknown outcome and changed arguments', async () => {
    const admissionId = await start();
    const effect = { admissionId, actionId: 'call-1', argsHash: 'a'.repeat(64) };
    await whatsappEffect(locals, { ...effect, operation: 'prepare' });
    await expect(
      whatsappEffect(locals, { ...effect, actionId: 'retry-new-id', operation: 'prepare' }),
    ).rejects.toMatchObject({ status: 409 });
    await whatsappEffect(locals, { ...effect, operation: 'committed' });
    effect.actionId = 'call-2';
    await whatsappEffect(locals, { ...effect, operation: 'prepare' });
    await whatsappEffect(locals, { ...effect, operation: 'unknown' });
    await expect(whatsappEffect(locals, { ...effect, operation: 'prepare' })).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      whatsappEffect(locals, { ...effect, argsHash: 'b'.repeat(64), operation: 'prepare' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('atomically consumes one OTP across concurrent confirmations and increments claim revision', async () => {
    const issue = await requestOtpClaim({
      supabaseId: USER,
      channel: 'whatsapp',
      channelUserId: '19995550102',
    });
    if (!issue.ok) throw Error('issue');
    const results = await Promise.all(
      [1, 2].map(() =>
        verifyOtpClaim({ supabaseId: USER, requestId: issue.requestId, code: issue.code }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });
  it('serializes OTP failures and locks out all later correct codes', async () => {
    const issue = await requestOtpClaim({
      supabaseId: USER,
      channel: 'whatsapp',
      channelUserId: '19995550102',
    });
    if (!issue.ok) throw Error('issue');
    await Promise.all(
      Array.from({ length: 6 }, () =>
        verifyOtpClaim({
          supabaseId: USER,
          requestId: issue.requestId,
          code: issue.code === '000000' ? '111111' : '000000',
        }),
      ),
    );
    expect(
      (await db`select attempts from pending_channel_claims where id=${issue.requestId}`)[0]
        .attempts,
    ).toBe(5);
    expect(
      await verifyOtpClaim({ supabaseId: USER, requestId: issue.requestId, code: issue.code }),
    ).toMatchObject({ ok: false });
  });
  it('allows exactly one concurrent start and one active turn per conversation', async () => {
    await ready();
    const first = await admitWhatsApp(locals, admitBase);
    if (!first.admissionId) throw Error('admit');
    const input = { ...admitBase, admissionId: first.admissionId, operation: 'start' };
    const results = await Promise.allSettled([
      whatsappTurn(locals, input),
      whatsappTurn(locals, input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const second = await admitWhatsApp(locals, { ...admitBase, providerMessageId: 'msg-2' });
    if (!second.admissionId) throw Error('admit');
    await expect(
      whatsappTurn(locals, { ...input, admissionId: second.admissionId }),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('blocks membership removal, transport stop and changed account bindings', async () => {
    const id = await start();
    await db`update channels set replies='none' where id='wa-test'`;
    await expect(assertWhatsAppAdmission(locals, id)).rejects.toMatchObject({ status: 403 });
    await expect(
      db`update channels set tenant_id=${OTHER} where id='wa-test'`,
    ).rejects.toMatchObject({ code: '23514' });
    await db`update channels set replies='bound' where id='wa-test'`;
    await db`delete from organization_members where profile_id=${USER}`;
    await expect(assertWhatsAppAdmission(locals, id)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects wrong-org gateway and provider proof mismatch', async () => {
    await expect(
      whatsappLease(
        { ...locals, tenantCtx: { tenantId: OTHER, db: {} as never } },
        { ...leaseBase, operation: 'acquire' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await whatsappLease(locals, { ...leaseBase, operation: 'acquire' });
    await expect(
      whatsappLease(locals, {
        ...leaseBase,
        operation: 'verify',
        generation: 1,
        providerAccountId: '19995550109',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('fences stale worker turns after takeover instead of rerunning them', async () => {
    const id = await start();
    await db`update whatsapp_account_leases set lease_until=now()-interval '1 second'`;
    const next = await whatsappLease(locals, {
      ...leaseBase,
      ownerId: 'worker-b',
      operation: 'acquire',
    });
    expect(next.generation).toBe(2);
    expect((await db`select state from whatsapp_assistant_turns where id=${id}`)[0].state).toBe(
      'reconcile_required',
    );
    await expect(assertWhatsAppAdmission(locals, id)).rejects.toMatchObject({ status: 403 });
  });
  it('consumes only a prior-turn exact-action confirmation once', async () => {
    const id = await start();
    const preview = {
      admissionId: id,
      actionName: 'note-create',
      argsHash: 'c'.repeat(64),
      operation: 'preview',
    };
    await whatsappConfirmation(locals, preview);
    const reply = { ...admitBase, admissionId: id, replyPart: 0 };
    await whatsappReply(locals, { ...reply, operation: 'prepare', text: 'Confirm note creation?' });
    await whatsappReply(locals, { ...reply, operation: 'sending' });
    await whatsappReply(locals, {
      ...reply,
      operation: 'confirmed',
      providerMessageId: 'preview-1',
    });
    await expect(
      whatsappConfirmation(locals, { ...preview, operation: 'consume', inputText: 'yes' }),
    ).rejects.toMatchObject({ status: 409 });
    await whatsappTurn(locals, { ...admitBase, admissionId: id, operation: 'complete' });
    const next = await admitWhatsApp(locals, { ...admitBase, providerMessageId: 'msg-2' });
    if (!next.admissionId) throw Error('admit');
    await whatsappTurn(locals, { ...admitBase, admissionId: next.admissionId, operation: 'start' });
    const confirmation = {
      ...preview,
      admissionId: next.admissionId,
      operation: 'consume',
      inputText: 'sí',
    };
    await expect(
      whatsappConfirmation(locals, { ...confirmation, argsHash: 'd'.repeat(64) }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      whatsappConfirmation(locals, { ...confirmation, inputText: 'please do something else' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(whatsappConfirmation(locals, confirmation)).resolves.toEqual({ ok: true });
    await expect(whatsappConfirmation(locals, confirmation)).rejects.toMatchObject({ status: 409 });
  });
  it('exposes no phone, turns or reply payloads to authenticated browser role', async () => {
    await ready();
    await admitWhatsApp(locals, admitBase);
    await expect(
      db.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select * from whatsapp_assistant_turns`;
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('shares canonical memory changes and deletion between independent channel callers', async () => {
    const actor = { orgId: ORG, principalId: USER, agentId: 'personal-test' };
    const saved = (await canonicalAgentMemory(actor, 'remember', {
      label: 'Coffee',
      type: 'preference',
      data: { milk: 'oat' },
    })) as { id: string };
    expect(
      await canonicalAgentMemory({ ...actor }, 'recall_entity', { name: 'Coffee' }),
    ).toMatchObject({ id: saved.id, data: { milk: 'oat' } });
    await canonicalAgentMemory({ ...actor }, 'update_entity', {
      id: saved.id,
      data: { milk: 'almond' },
    });
    expect(await canonicalAgentMemory(actor, 'search_facts', { query: 'Coffee' })).toEqual([
      expect.objectContaining({ data: { milk: 'almond' } }),
    ]);
    expect(
      await canonicalAgentMemory({ ...actor, orgId: OTHER }, 'search_facts', { query: 'Coffee' }),
    ).toEqual([]);
    expect(
      await canonicalAgentMemory({ ...actor, principalId: GATEWAY }, 'recall_entity', {
        name: 'Coffee',
      }),
    ).toBeNull();
    await canonicalAgentMemory({ ...actor }, 'forget', { id: saved.id });
    expect(await canonicalAgentMemory(actor, 'recall_entity', { name: 'Coffee' })).toBeNull();
    expect((await db`select id from agent_memories where source_id=${saved.id}`).length).toBe(0);
    const extracted = (await canonicalAgentMemory(actor, 'remember_extracted', {
      content: 'Prefers detailed weekly project updates with concrete next steps',
      category: 'preference',
      confidence: 0.85,
    })) as { id: string };
    const entity = (await canonicalAgentMemory(actor, 'remember', {
      label: 'Project updates',
    })) as { id: string };
    expect(
      await canonicalAgentMemory({ ...actor }, 'search_facts', { query: 'weekly project' }),
    ).toEqual([
      expect.objectContaining({
        id: extracted.id,
        data: {
          content: 'Prefers detailed weekly project updates with concrete next steps',
          category: 'preference',
          confidence: 0.85,
          provenance: 'auto-extract',
        },
      }),
    ]);
    await canonicalAgentMemory(actor, 'link_objects', {
      fromId: entity.id,
      toId: extracted.id,
      relType: 'related_to',
      weight: 0.8,
    });
    // Repeated extraction context links replace the same typed edge instead of duplicating it.
    await canonicalAgentMemory(actor, 'link_objects', {
      fromId: entity.id,
      toId: extracted.id,
      relType: 'related_to',
      weight: 0.9,
    });
    expect(await canonicalAgentMemory(actor, 'find_related', { entityId: entity.id })).toEqual([
      expect.objectContaining({ id: extracted.id }),
    ]);
    await expect(
      canonicalAgentMemory({ ...actor, principalId: GATEWAY }, 'link_objects', {
        fromId: entity.id,
        toId: extracted.id,
        relType: 'related_to',
        weight: 0.8,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      canonicalAgentMemory(actor, 'remember_extracted', {
        content: 'Invalid',
        category: 'fact',
        confidence: 2,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await canonicalAgentMemory(actor, 'forget', { id: extracted.id });
    expect(await canonicalAgentMemory(actor, 'find_related', { entityId: entity.id })).toEqual([]);
  });
  it('does not let guessed IDs update or delete another principal memory', async () => {
    const actor = { orgId: ORG, principalId: USER, agentId: 'personal-test' };
    const saved = (await canonicalAgentMemory(actor, 'remember', {
      label: 'Private fact',
      data: { private: true },
    })) as { id: string };
    expect(
      await canonicalAgentMemory({ ...actor, principalId: GATEWAY }, 'update_entity', {
        id: saved.id,
        label: 'Stolen',
      }),
    ).toBeNull();
    expect(
      await canonicalAgentMemory({ ...actor, orgId: OTHER }, 'forget', { id: saved.id }),
    ).toEqual({ deleted: 0 });
    expect(
      await canonicalAgentMemory(actor, 'recall_entity', { name: 'Private fact' }),
    ).toMatchObject({ id: saved.id });
  });

  it('adopts legacy memory only through a unique active agent organization assignment', async () => {
    const actor = { orgId: ORG, principalId: USER, agentId: 'personal-test' };
    await db`insert into agent_memories(org_id,agent_id,content,source,source_id,metadata) values
      (${ORG},'personal-test','Legacy preference','kg','legacy-1','{"kgType":"preference","data":{"milk":"oat"}}'),
      (${OTHER},'personal-test','Other org secret','kg','legacy-2','{}')`;
    expect(
      await canonicalAgentMemory(actor, 'recall_entity', { name: 'Legacy preference' }),
    ).toMatchObject({ id: 'legacy-1' });
    expect(
      (await db`select profile_id from agent_memories where source_id='legacy-1'`)[0].profile_id,
    ).toBe(USER);
    expect(
      (await db`select profile_id from agent_memories where source_id='legacy-2'`)[0].profile_id,
    ).toBeNull();
    await db`insert into agent_memories(org_id,agent_id,content,source,source_id) values(${ORG},'personal-test','Ambiguous secret','kg','legacy-3')`;
    await db`insert into personal_agents(id,profile_id,agent_id,gateway_id,display_name,provisioning_status) values('ambiguous',${GATEWAY},'personal-test',${GATEWAY},'other','active')`;
    expect(
      await canonicalAgentMemory(actor, 'recall_entity', { name: 'Ambiguous secret' }),
    ).toBeNull();
    expect(
      (await db`select profile_id from agent_memories where source_id='legacy-3'`)[0].profile_id,
    ).toBeNull();
  });

  it('semantically recalls shared canonical memory then observes deletion without a local mirror', async () => {
    mocks.embedOn = true;
    const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    mocks.embed.mockResolvedValue(vector);
    const actor = { orgId: ORG, principalId: USER, agentId: 'personal-test' };
    const saved = (await canonicalAgentMemory(actor, 'remember', {
      label: 'Morning drink',
      type: 'preference',
      data: { milk: 'oat' },
    })) as { id: string };
    expect(
      await canonicalAgentMemory({ ...actor }, 'search_facts', {
        query: 'What should I put in my coffee?',
      }),
    ).toEqual([expect.objectContaining({ id: saved.id })]);
    await canonicalAgentMemory(actor, 'forget', { id: saved.id });
    expect(
      await canonicalAgentMemory({ ...actor }, 'search_facts', {
        query: 'What should I put in my coffee?',
      }),
    ).toEqual([]);
  });

  it('fences delayed KG mirror packets after canonical forget', async () => {
    const actor = { orgId: ORG, principalId: USER, agentId: 'personal-test' };
    const saved = (await canonicalAgentMemory(actor, 'remember', {
      label: 'Forget this',
      data: { private: true },
    })) as { id: string };
    await canonicalAgentMemory(actor, 'forget', { id: saved.id });
    const replay =
      await db`insert into agent_memories(org_id,agent_id,content,source,source_id,metadata)
      values(${ORG},'personal-test','Forget this','kg',${saved.id},'{}') returning id`;
    expect(replay).toHaveLength(0);
    expect(await canonicalAgentMemory(actor, 'recall_entity', { name: 'Forget this' })).toBeNull();
    expect(
      (await db`select source_id from agent_memory_tombstones where source_id=${saved.id}`).length,
    ).toBe(1);
  });

  it('rechecks revoked admission after embedding and before memory mutation', async () => {
    const admissionId = await start();
    mocks.embedOn = true;
    mocks.embed.mockImplementation(async () => {
      await db`delete from organization_members where profile_id=${USER}`;
      return Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    });
    await expect(
      canonicalAgentMemory(
        { orgId: ORG, principalId: USER, agentId: 'personal-test' },
        'remember',
        { label: 'Must not persist', data: { secret: true } },
        async () => {
          await assertWhatsAppAdmission(locals, admissionId);
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect((await db`select id from agent_memories where content='Must not persist'`).length).toBe(
      0,
    );
  });
  it('imports a reviewed snapshot with typed weighted graph edges and rejects digest or scope changes', async () => {
    const now = Date.now();
    const nodes = [
      {
        id: 'node-a',
        type: 'entity',
        label: 'Project A',
        data: {},
        createdAt: now,
        updatedAt: now,
        ttl: null,
      },
      {
        id: 'node-b',
        type: 'fact',
        label: 'Delivery Friday',
        data: {},
        createdAt: now,
        updatedAt: now,
        ttl: null,
      },
    ];
    const relationships = [
      { fromId: 'node-a', toId: 'node-b', relType: 'part_of', weight: 0.7, createdAt: now },
    ];
    const snapshot = {
      schemaVersion: 1,
      orgId: ORG,
      profileId: USER,
      agentId: 'personal-test',
      exportedAt: now,
      source: {
        dbPath: '/synthetic/readonly.sqlite',
        snapshotSha256: createHash('sha256')
          .update(JSON.stringify({ nodes, relationships }))
          .digest('hex'),
      },
      nodes,
      relationships,
    };
    expect(await importPersonalMemory(servicePool, snapshot)).toMatchObject({
      dryRun: true,
      nodes: 2,
    });
    expect((await db`select id from agent_memories`).length).toBe(0);
    expect(await importPersonalMemory(servicePool, snapshot, true)).toMatchObject({ imported: 2 });
    const actor = { orgId: ORG, principalId: USER, agentId: 'personal-test' };
    expect(
      await canonicalAgentMemory(actor, 'find_related', { entityId: 'node-a', relType: 'part_of' }),
    ).toEqual([expect.objectContaining({ id: 'node-b' })]);
    expect(
      await canonicalAgentMemory(actor, 'find_related', {
        entityId: 'node-a',
        relType: 'contradicts',
      }),
    ).toEqual([]);
    expect(() => validatePersonalMemoryExport({ ...snapshot, nodes: [] })).toThrow('digest');
    await expect(
      importPersonalMemory(servicePool, { ...snapshot, orgId: OTHER }, true),
    ).rejects.toThrow('assignment');
    await canonicalAgentMemory(actor, 'forget', { id: 'node-b' });
    expect(await importPersonalMemory(servicePool, snapshot, true)).toMatchObject({ skipped: 1 });
    expect(
      await canonicalAgentMemory(actor, 'find_related', { entityId: 'node-a', relType: 'part_of' }),
    ).toEqual([]);
  });
});
