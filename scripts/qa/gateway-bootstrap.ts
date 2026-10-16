#!/usr/bin/env bun
/**
 * `bun scripts/qa/gateway-bootstrap.ts` — the Postgres + gateway-side half of
 * `dev:local --gateway`. Runs AFTER the seed, only in gateway mode.
 *
 * Spec: meta-repo `specs/011-dev-local-gateway-mode/` (D5, D6, D7).
 *
 * Why this is not a `scripts/qa/seed/` module: the seed matrix is an inventory
 * of rows the seed ALWAYS writes, and `seed.contract.test.ts` asserts coverage
 * over it. Registering rows that only exist in gateway mode would make that
 * coverage assertion mode-dependent. Recorded in the meta-repo open-items
 * ledger (proposals/2026-10-16-hub-dev-local-gateway-followups.md).
 *
 * Writes:
 *  1. one `gateway` row — org = the QA business org, channel 'dev',
 *     url ws://127.0.0.1:18789, token sealed with the stack's ENCRYPTION_KEY
 *     exactly as a production row is, so POST /api/servers/[id]/token and
 *     resolveServerTokenAuth both work unmodified;
 *  2. a `user_gateway` link per QA profile, so the dashboard offers the
 *     gateway as that persona's host (listGatewayHostsForUser);
 *  3. `personal_agents.gateway_id` -> that row, `provisioning_status`
 *     'active', and a `personal-` prefix on `agent_id` (the gateway gates its
 *     hub-module tools on that prefix — minion/src/agents/tools/hub/hub-common.ts);
 *  4. the agents themselves, on the gateway, over its own `agents.create` RPC.
 *
 * Idempotent: every write is an upsert or a no-op second time round.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { parseEnvFile } from './snapshot-env';
import { assertLoopback } from './seed/db';
import { matrixUuid } from './seed/ids';
import { ORG_BUSINESS } from './seed/tenancy';
import {
  GATEWAY_WS_URL,
  LOCAL_GATEWAY_NAME,
  LOCAL_SERVER_ID,
  loadOrCreateGatewayToken,
} from './gateway';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TAG = 'qa:gateway-bootstrap';
/** Deterministic primary key PER ORG, so a re-run updates instead of inserting.
 *  One row per org is required, not optional: the hub resolves a host for the
 *  ACTIVE org (gateway.pg.service.ts listGatewayHostsForUser is fail-closed on
 *  org), so a persona whose active org has no row sees an offline assistant
 *  even though the gateway is up. The unique index is
 *  (url, coalesce(org_id,…), channel), so the same url + token is legal for
 *  every org. */
export function gatewayRowId(orgId: string): string {
  return matrixUuid('gateway.local.dev', orgId);
}

/**
 * Pure: the `legacy_server_id` for one org's row. It MUST be unique per row:
 * the dashboard keys a host by `legacy_server_id ?? id`
 * (gateway.pg.service.ts listGatewayHostsForUser) and
 * `POST /api/servers/[id]/token` resolves that id back to a single row with
 * `limit 1`. Five rows sharing one id made it resolve to an arbitrary org's
 * row, so every persona outside that org got
 * `gateway not assigned to active org -> 404` and an offline assistant.
 *
 * `primary` (the first seeded org) keeps the bare id, because that is the
 * `serverId` baked into the container's `minion.json` hubMetrics, which the
 * hub matches as a hint on inbound gateway calls
 * (src/server/auth/resolve-identity.ts matchesServerIdHint).
 */
export function legacyServerIdFor(orgId: string, primary: boolean): string {
  return primary ? LOCAL_SERVER_ID : `${LOCAL_SERVER_ID}-${orgId.slice(0, 8)}`;
}

/** Pure: the `personal-`-prefixed agent id for a seeded `qa_<hex>` one.
 *  Already-prefixed ids are returned unchanged (idempotence). */
export function personalAgentId(agentId: string): string {
  if (agentId.startsWith('personal-')) return agentId;
  return `personal-${agentId.replace(/^qa_/, '')}`;
}

/** Pure: the `agents.create` params, same shape the hub's own provisioner
 *  sends (src/server/services/personal-agent-provisioner.ts
 *  getProvisioningPayload) — the gateway derives its agent id from `name`. */
export function agentCreateParams(agentId: string): { name: string; workspace: string } {
  return { name: agentId, workspace: `~/.minion/agents/${agentId}/workspace` };
}

interface BootstrapResult {
  gatewayIds: string[];
  orgs: number;
  links: number;
  agents: string[];
  created: string[];
  alreadyPresent: string[];
}

/** Steps 1-3: the Postgres rows. Returns the agent ids to create on the gateway. */
async function writeRows(
  sql: postgres.Sql,
  sealed: { ciphertext: string; iv: string },
): Promise<{ gatewayIds: string[]; orgs: number; links: number; agents: string[] }> {
  const orgs = await sql<{ id: string }[]>`select id from organizations order by created_at, id`;
  if (!orgs.length) throw new Error(`${TAG} — no organizations found; run the seed first`);
  const wanted = orgs.map((o, i) => ({
    orgId: o.id,
    id: gatewayRowId(o.id),
    legacyServerId: legacyServerIdFor(o.id, i === 0),
  }));
  const ids = wanted.map((w) => w.id);

  // Drop any local-gateway row that is no longer one of ours — notably the
  // single pre-multi-org row keyed by the unsalted id. Scoped to this url and
  // channel so nothing else is touched. personal_agents.gateway_id is
  // ON DELETE SET NULL and is re-set below.
  await sql`
    delete from gateway
    where url = ${GATEWAY_WS_URL} and channel = 'dev' and not (id = any(${ids}::uuid[]))
  `;

  for (const { orgId, id, legacyServerId } of wanted) {
    await sql`
      insert into gateway (id, legacy_server_id, org_id, name, url, token_ciphertext, token_iv, auth_mode, channel)
      values (${id}, ${legacyServerId}, ${orgId}, ${LOCAL_GATEWAY_NAME},
              ${GATEWAY_WS_URL}, ${sealed.ciphertext}, ${sealed.iv}, 'token', 'dev')
      on conflict (id) do update set
        legacy_server_id = excluded.legacy_server_id,
        org_id = excluded.org_id,
        name = excluded.name,
        url = excluded.url,
        token_ciphertext = excluded.token_ciphertext,
        token_iv = excluded.token_iv,
        auth_mode = excluded.auth_mode,
        channel = excluded.channel,
        updated_at = now()
    `;
  }
  // Conflict on the primary key, not on `url`: the real unique index is the
  // expression index gateway_uniq_url_org_channel (url, coalesce(org_id, …),
  // channel), which ON CONFLICT cannot name. The ids are deterministic, so a
  // re-run updates the same rows.

  // A link per (persona, gateway row of an org that persona belongs to):
  // non-admin personas only see hosts they are linked to
  // (gateway.pg.service.ts listGatewayHostsForUser).
  const linked = await sql<{ profile_id: string }[]>`
    insert into user_gateway (profile_id, gateway_id, is_default)
    select om.profile_id, g.id, true
    from organization_members om
    join gateway g on g.org_id = om.organization_id and g.url = ${GATEWAY_WS_URL} and g.channel = 'dev'
    on conflict (profile_id, gateway_id) do update set is_default = true
    returning profile_id
  `;

  const agents = await sql<{ agent_id: string }[]>`
    update personal_agents pa set
      agent_id = case
        when pa.agent_id like 'personal-%' then pa.agent_id
        else 'personal-' || regexp_replace(pa.agent_id, '^qa_', '')
      end,
      gateway_id = coalesce(
        -- the row for an org this persona actually belongs to…
        (select g.id from organization_members om
           join gateway g on g.org_id = om.organization_id
          where om.profile_id = pa.profile_id
            and g.url = ${GATEWAY_WS_URL} and g.channel = 'dev'
          order by g.created_at, g.id limit 1),
        -- …else any local row, so an org-less persona still resolves.
        (select g.id from gateway g
          where g.url = ${GATEWAY_WS_URL} and g.channel = 'dev'
          order by g.created_at, g.id limit 1)
      ),
      provisioning_status = 'active',
      provisioning_error = null,
      updated_at = now()
    returning pa.agent_id
  `;
  // profiles.personal_agent_id mirrors personal_agents.agent_id; the renames
  // above would otherwise orphan it.
  await sql`
    update profiles p set personal_agent_id = pa.agent_id
    from personal_agents pa
    where pa.profile_id = p.id and coalesce(p.personal_agent_id, '') <> pa.agent_id
  `;

  return {
    gatewayIds: ids,
    orgs: wanted.length,
    links: linked.length,
    agents: agents.map((a) => a.agent_id),
  };
}

/** Step 4: create each agent on the gateway itself. */
async function createAgentsOnGateway(
  token: string,
  agentIds: string[],
): Promise<{ created: string[]; alreadyPresent: string[] }> {
  const { createNodeGatewayClient } = await import('@minion-stack/shared/node');
  const client = createNodeGatewayClient({
    url: GATEWAY_WS_URL,
    // The gateway's control-UI origin check rejects a missing Origin
    // (minion/src/gateway/auth/origin-check.ts checkBrowserOrigin); `ws` sends
    // none. Send the dev server's own origin — loopback-to-loopback, which is
    // the same rule that lets the browser in.
    headers: { Origin: 'http://127.0.0.1:5199' },
    autoReconnect: false,
    requestTimeoutMs: 30_000,
    onChallenge: async () => ({
      minProtocol: 3,
      maxProtocol: 3,
      // `client.id` is a closed enum in the gateway's connect schema, so the
      // bootstrap identifies as the control UI — the same identity the
      // dashboard uses (src/lib/services/gateway.svelte.ts).
      client: { id: 'minion-control-ui', version: '1.0', platform: 'web', mode: 'ui' },
      role: 'operator',
      scopes: [
        'operator.admin',
        'operator.read',
        'operator.write',
        'operator.approvals',
        'operator.pairing',
      ],
      auth: { token },
    }),
    // The bootstrap does not care about live events; swallow them explicitly
    // rather than letting the client's default console.error noise the banner.
    onEvent: () => {},
    onEventError: () => {},
  });

  const created: string[] = [];
  const alreadyPresent: string[] = [];
  try {
    await client.connect();
    const list = await client.request<{ agents?: { id?: string; name?: string }[] }>(
      'agents.list',
      {},
    );
    const existing = new Set(
      (list?.agents ?? []).flatMap((a) => [a.id, a.name].filter((v): v is string => !!v)),
    );
    for (const agentId of agentIds) {
      if (existing.has(agentId)) {
        alreadyPresent.push(agentId);
        continue;
      }
      await client.request('agents.create', agentCreateParams(agentId));
      created.push(agentId);
    }
  } finally {
    client.close();
  }
  return { created, alreadyPresent };
}

export async function bootstrapGateway(root: string): Promise<BootstrapResult> {
  const envQaPath = join(root, '.env.qa');
  if (!existsSync(envQaPath)) {
    throw new Error(`${TAG} — ${envQaPath} does not exist (run the QA pipeline first)`);
  }
  const qaVars = parseEnvFile(readFileSync(envQaPath, 'utf8'));
  const dbUrl = assertLoopback(
    qaVars.SUPABASE_DB_URL ?? process.env.SUPABASE_DB_URL,
    'SUPABASE_DB_URL',
  );
  const encryptionKey = qaVars.ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error(`${TAG} — ENCRYPTION_KEY is missing from .env.qa`);
  // @minion-stack/db/crypto derives its key from process.env at call time.
  process.env.ENCRYPTION_KEY = encryptionKey;
  const { sealSecret } = await import('@minion-stack/db/crypto');

  const token = loadOrCreateGatewayToken(root);
  const sealed = sealSecret(token);

  const sql = postgres(dbUrl, { max: 1 });
  let rows: { gatewayIds: string[]; orgs: number; links: number; agents: string[] };
  try {
    rows = await writeRows(sql, sealed);
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log(
    `${TAG} — ${rows.orgs} gateway row(s), one per org (${LOCAL_SERVER_ID}) on ${GATEWAY_WS_URL}, ` +
      `${rows.links} persona link(s), ${rows.agents.length} personal agent(s) pointed at one`,
  );

  const { created, alreadyPresent } = await createAgentsOnGateway(token, rows.agents);
  console.log(
    `${TAG} — on the gateway: ${created.length} agent(s) created, ${alreadyPresent.length} already present`,
  );
  return { ...rows, created, alreadyPresent };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  bootstrapGateway(ROOT).catch((err) => {
    console.error(`${TAG} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
