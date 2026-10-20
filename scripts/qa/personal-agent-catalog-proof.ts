#!/usr/bin/env bun
/**
 * Owned loopback acceptance: real GoTrue session -> hosted personal-agent verifier
 * -> PostgreSQL assignment -> gateway principal/manifest -> ordinary tool factory.
 * Run with `bun run qa:personal-agent-catalog` and the existing .env.qa resolved.
 * Requires MINION_QA_GATEWAY_REPO (built candidate checkout), AUTH_DISABLED=false,
 * and a local Hub started with MINION_HUB_ORIGIN=http://127.0.0.1:5199.
 * Never seeds, migrates,
 * repairs existing rows, uses a model, or sends an external notification.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { encryptToken } from '@minion-stack/db/crypto';

function required(name: string): string {
  const value = process.env[name]?.trim();
  assert(value, `Missing ${name}`);
  return value;
}
function local(raw: string, protocol: string, port: number): string {
  const url = new URL(raw);
  assert.equal(url.protocol, protocol);
  assert.equal(url.hostname, '127.0.0.1', 'Only numeric loopback is accepted');
  assert.equal(url.port, String(port));
  assert(!url.search && !url.hash, 'No URL options');
  return raw;
}
const hub = local(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5199', 'http:', 5199);
const authUrl = local(required('PUBLIC_SUPABASE_URL'), 'http:', 54421);
const dbUrl = required('SUPABASE_DB_URL');
local(dbUrl, new URL(dbUrl).protocol === 'postgres:' ? 'postgres:' : 'postgresql:', 54422);
assert.equal(process.env.AUTH_DISABLED, 'false', 'Authenticated QA app required');
const repo = resolve(required('MINION_QA_GATEWAY_REPO'));
// Resolve the real executable before isolating HOME; PATH may contain manager shims.
const nodeExecutable = execFileSync('node', ['-p', 'process.execPath'], {
  encoding: 'utf8',
}).trim();
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
const admin = createClient(authUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tag = randomUUID();
const ids = {
  org: randomUUID(),
  profile: randomUUID(),
  gateway: randomUUID(),
  olderGateway: randomUUID(),
  wrongOrg: randomUUID(),
  wrongGateway: randomUUID(),
  agent: `personal-qa-${tag}`,
  row: `qa-${tag}`,
};
const token = randomBytes(32).toString('hex');
const password = randomBytes(24).toString('base64url');
const email = `catalog-${tag}@example.invalid`;
const scratch = await mkdtemp(join(tmpdir(), 'minion-binding-proof-'));
const receiptFile = process.env.MINION_QA_RECEIPT ?? join(scratch, 'receipt.json');
assert(!receiptFile.startsWith(repo + '/'), 'Receipt must be outside the candidate checkout');
let gateway: ChildProcess | undefined;
let wrongTargetCalls = 0;
const sentinel = createServer((socket) => {
  wrongTargetCalls++;
  socket.destroy();
});
let createdUserId: string | undefined;
let fixturesCommitted = false;
const receipt: Record<string, unknown> = { tag, ids, modelCalls: 0, productionCalls: 0 };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baseline =
  await sql`select id, gateway_id, agent_id, provisioning_status, updated_at::text from personal_agents order by id`;
receipt.existingAssignmentHash = digest(baseline);
// Secret-free ownership/cleanup plan is durable BEFORE the first fixture write.
await writeFile(
  join(scratch, 'ownership.json'),
  JSON.stringify(
    {
      ids,
      cleanup: [
        'stop owned child PID',
        'delete personal_agents by row/profile',
        'delete owned organization IDs (cascading fixtures)',
        'delete owned GoTrue profile',
        'assert no owned rows/process remain',
      ],
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

const childEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: join(scratch, 'home'),
  TMPDIR: scratch,
  NODE_ENV: 'test',
  MINION_NO_RESPAWN: '1',
  MINION_STATE_DIR: join(scratch, 'state'),
  MINION_CONFIG_PATH: join(scratch, 'gateway.json'),
  MINION_GATEWAY_TOKEN: token,
  MINION_DISABLE_BONJOUR: '1',
  MINION_SKIP_BROWSER_CONTROL_SERVER: '1',
  MINION_SKIP_CANVAS_HOST: '1',
  MINION_SKIP_CRON: '1',
};
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 5000))]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}
async function request(path: string, init: RequestInit = {}) {
  return fetch(`${hub}${path}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
}
async function manifest(serverId = ids.gateway, orgId?: string) {
  return request(
    `/api/gateway/query/tool-catalog?agentId=${ids.agent}${orgId ? `&orgId=${orgId}` : ''}`,
    {
      headers: { authorization: `Bearer ${token}`, 'x-minion-server-id': serverId },
    },
  );
}
async function waitGateway() {
  for (let n = 0; n < 90; n++) {
    assert(
      gateway && gateway.exitCode === null && gateway.signalCode === null,
      'Owned gateway exited before readiness',
    );
    try {
      const response = await fetch('http://127.0.0.1:18791/health', {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      /* bounded startup */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Owned gateway readiness timed out');
}
try {
  await mkdir(childEnv.HOME!, { recursive: true, mode: 0o700 });
  await mkdir(join(scratch, 'workspace'), { mode: 0o700 });
  // Reserve a sentinel and verify our actual runtime port is free before spawning.
  await new Promise<void>((yes, no) => {
    sentinel.once('error', no);
    sentinel.listen(0, '127.0.0.1', yes);
  });
  const address = sentinel.address();
  assert(address && typeof address === 'object');
  const probe = createServer();
  await new Promise<void>((yes, no) => {
    probe.once('error', no);
    probe.listen(18791, '127.0.0.1', yes);
  });
  await new Promise<void>((yes) => probe.close(() => yes()));
  await writeFile(
    childEnv.MINION_CONFIG_PATH!,
    JSON.stringify({
      logging: { file: join(scratch, 'gateway.log') },
      gateway: {
        mode: 'local',
        bind: 'loopback',
        port: 18791,
        auth: { mode: 'token', token },
        // The server RPC client uses shared-token control-UI auth without a device.
        // This fixture is loopback-only, with one exact origin and a random token.
        controlUi: { enabled: false, allowedOrigins: [hub], allowInsecureAuth: true },
        reload: { mode: 'off' },
      },
      discovery: { mdns: { mode: 'off' } },
      cron: { enabled: false },
      browser: { enabled: false },
      plugins: { enabled: false },
      agents: {
        list: [
          {
            id: ids.agent,
            name: 'Existing QA personality',
            workspace: join(scratch, 'workspace'),
            personality: { preset: 'professional', configured: true },
          },
        ],
      },
    }),
    { mode: 0o600 },
  );
  let runtimeLog = '';
  gateway = spawn(
    nodeExecutable,
    ['minion.mjs', 'gateway', '--allow-unconfigured', '--bind', 'loopback', '--port', '18791'],
    { cwd: repo, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  gateway.stdout?.on('data', (data) => {
    runtimeLog = (runtimeLog + String(data)).slice(-20_000);
  });
  gateway.stderr?.on('data', (data) => {
    runtimeLog = (runtimeLog + String(data)).slice(-20_000);
  });
  gateway.on('error', () => {});
  receipt.gatewayPid = gateway.pid;
  try {
    await waitGateway();
  } catch (error) {
    // Private scratch diagnostic can contain runtime config paths; never emit it.
    await writeFile(join(scratch, 'runtime.log'), runtimeLog, { mode: 0o600 });
    throw error;
  }
  const [collision] = await sql`select
    (select count(*) from organizations where id in (${ids.org},${ids.wrongOrg})) +
    (select count(*) from profiles where id=${ids.profile}) +
    (select count(*) from gateway where id in (${ids.gateway},${ids.olderGateway},${ids.wrongGateway})) +
    (select count(*) from personal_agents where id=${ids.row} or agent_id=${ids.agent}) as count`;
  assert.equal(Number(collision.count), 0, 'Owned fixture IDs collided');
  const runtimeBefore = await readFile(childEnv.MINION_CONFIG_PATH!, 'utf8');
  const created = await admin.auth.admin.createUser({
    id: ids.profile,
    email,
    password,
    email_confirm: true,
  });
  createdUserId = created.data.user?.id;
  assert(!created.error && createdUserId === ids.profile, 'Owned GoTrue user creation failed');

  const sealed = encryptToken(token);
  await sql.begin(async (tx) => {
    await tx`insert into organizations (id,name,slug,kind,onboarded_at) values
      (${ids.org},'Owned catalog acceptance',${`qa-catalog-${tag}`},'business',now()),
      (${ids.wrongOrg},'Owned wrong authority',${`qa-wrong-${tag}`},'business',now())`;
    await tx`insert into profiles(id,email,display_name,role,account_type,onboarded_at,personal_agent_id)
      values(${ids.profile},${email},'Owned QA viewer','user','person',now(),${ids.agent})
      on conflict(id) do update set onboarded_at=now(),personal_agent_id=${ids.agent}`;
    await tx`insert into organization_members(organization_id,profile_id,role) values(${ids.org},${ids.profile},'member')`;
    await tx`insert into member_roles(org_id,profile_id,role_key) values(${ids.org},${ids.profile},'viewer')`;
    for (const [id, org, url, age] of [
      [ids.olderGateway, ids.org, `ws://127.0.0.1:${address.port}`, '2 minutes'],
      [ids.gateway, ids.org, 'ws://127.0.0.1:18791', '1 minute'],
      [ids.wrongGateway, ids.wrongOrg, `ws://127.0.0.1:${address.port}`, '1 minute'],
    ]) {
      await tx`insert into gateway(id,org_id,name,url,token_ciphertext,token_iv,auth_mode,channel,created_at)
        values(${id},${org},'Owned QA gateway',${url},${sealed.encrypted},${sealed.iv},'token','prd',now()-${age}::interval)`;
    }
    await tx`insert into gateway_lease(org_id,channel,gateway_id,expires_at) values(${ids.org},'prd',${ids.gateway},now()+interval '5 minutes')`;
    await tx`insert into personal_agents(id,profile_id,agent_id,display_name,provisioning_status,gateway_id)
      values(${ids.row},${ids.profile},${ids.agent},'Preserved legacy QA','active',null)`;
    await tx`insert into pos_settings(org_id,currency) values(${ids.org},'PEN')`;
    for (const [code, name, price, kind, active] of [
      ['S1', 'QA highest service A', 250, 'service', true],
      ['S2', 'QA highest service B', 250, 'service', true],
      ['S3', 'QA cheaper service', 75, 'service', true],
      ['S4', 'QA missing price', null, 'service', true],
      ['S5', 'QA inactive service', 999, 'service', false],
      ['P1', 'QA excluded product', 9999, 'product', true],
    ] as const) {
      await tx`insert into fin_products(id,org_id,code,name,unit_price,kind,active)
        values(${randomUUID()},${ids.org},${code},${name},${price},${kind},${active})`;
    }
  });
  fixturesCommitted = true;
  const before = await manifest();
  assert.equal(before.status, 403, 'NULL assignment must deny manifest');
  assert.equal((await before.json()).code, 'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED');
  const jar = new Map<string, string>();
  const auth = createServerClient(authUrl, required('PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) jar.set(cookie.name, cookie.value);
      },
    },
  });
  const login = await auth.auth.signInWithPassword({ email, password });
  assert(!login.error && login.data.user?.id === ids.profile, 'Owned session login failed');
  jar.set('active_org', ids.org);
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const body = { status: 'active' };
  const activate = () =>
    request('/api/personal-agent/provision', {
      method: 'POST',
      headers: { cookie, origin: hub, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const activated = await request('/api/personal-agent/create', {
    method: 'POST',
    headers: { cookie, origin: hub, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(activated.status, 200, `Hosted verification status ${activated.status}`);
  const [bound] =
    await sql`select gateway_id,agent_id,provisioning_status from personal_agents where id=${ids.row}`;
  assert.deepEqual(bound, {
    gateway_id: ids.gateway,
    agent_id: ids.agent,
    provisioning_status: 'active',
  });
  assert.equal((await activate()).status, 200, 'Repeated legacy verification is idempotent');
  assert.equal(
    await readFile(childEnv.MINION_CONFIG_PATH!, 'utf8'),
    runtimeBefore,
    'Binding repair changed runtime customization',
  );
  assert.equal(wrongTargetCalls, 0, 'Live lease must win over older candidate without probing it');
  const after = await manifest();
  assert.equal(after.status, 200);
  const catalog = await after.json();
  assert(catalog.tools.some((tool: { name: string }) => tool.name === 'catalog_query'));
  assert.equal(catalog.orgId, ids.org);
  assert.equal((await manifest(ids.wrongGateway)).status, 403);
  assert.equal((await manifest(ids.gateway, ids.wrongOrg)).status, 403);
  const resultText = execFileSync('bun', ['test/fixtures/assistant-catalog-factory-runner.ts'], {
    cwd: repo,
    env: {
      ...childEnv,
      MINION_QA_CATALOG_HUB_URL: hub,
      MINION_QA_CATALOG_TOKEN: token,
      MINION_QA_CATALOG_SERVER_ID: ids.gateway,
      MINION_QA_CATALOG_AGENT_ID: ids.agent,
    },
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 2_000_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const marker = resultText
    .split('\n')
    .find((line) => line.startsWith('MINION_QA_CATALOG_RESULT='));
  assert(marker, 'Normal factory runner emitted no result');
  const result = JSON.parse(marker.slice('MINION_QA_CATALOG_RESULT='.length));
  assert.equal(result.admitted, true);
  assert.equal(result.discovered, true);
  assert.equal(result.selectionMode, 'off');
  assert.equal(result.kind, 'service');
  assert.equal(result.currency, 'PEN');
  assert.equal(result.maxPrice, 250);
  assert.equal(result.matchedCount, 4);
  assert.equal(result.missingPriceCount, 1);
  assert.equal(result.tiedAtMaximum, 2);
  assert.equal(result.source.path, '/pos/catalog');
  assert.deepEqual(
    result.items.map((item: { name: string }) => item.name),
    ['QA highest service A', 'QA highest service B', 'QA cheaper service'],
  );
  receipt.result = result;
  receipt.beforeStatus = 403;
  receipt.afterStatus = 200;
  receipt.wrongTargetCalls = wrongTargetCalls;
  receipt.path =
    'GoTrue session -> hosted verify-only route -> real gateway roster -> binding -> manifest -> normal factory/search/query';
  receipt.pass = true;
} catch (error) {
  receipt.pass = false;
  // Error details can contain private child stdout. Keep public evidence sanitized.
  receipt.failure = error instanceof Error ? error.name : 'UnknownError';
  await writeFile(
    join(scratch, 'failure.log'),
    error instanceof Error ? (error.stack ?? error.name) : 'Unknown failure',
    { mode: 0o600 },
  );
  process.exitCode = 1;
} finally {
  if (gateway) await stop(gateway);
  await new Promise<void>((yes) => sentinel.close(() => yes()));
  if (fixturesCommitted) {
    await sql`delete from personal_agents where id=${ids.row} and profile_id=${ids.profile}`;
    await sql.begin(async (tx) => {
      await tx`delete from gateway_lease where org_id in (${ids.org},${ids.wrongOrg})`;
      await tx`delete from gateway where id in (${ids.gateway},${ids.olderGateway},${ids.wrongGateway})`;
      await tx`delete from fin_products where org_id=${ids.org}`;
      await tx`delete from pos_settings where org_id=${ids.org}`;
      await tx`delete from member_roles where org_id=${ids.org} and profile_id=${ids.profile}`;
      await tx`delete from organizations where id in (${ids.org},${ids.wrongOrg})`;
    });
  }
  if (createdUserId) {
    const deleted = await admin.auth.admin.deleteUser(createdUserId);
    assert(!deleted.error, 'Owned GoTrue user cleanup failed');
  }
  if (createdUserId) await sql`delete from profiles where id=${createdUserId}`;
  const remaining =
    await sql`select id from personal_agents where id=${ids.row} or profile_id=${ids.profile}`;
  assert.equal(remaining.length, 0);
  const [owned] = await sql`select
    (select count(*) from organizations where id in (${ids.org},${ids.wrongOrg})) +
    (select count(*) from profiles where id=${ids.profile}) +
    (select count(*) from gateway where id in (${ids.gateway},${ids.olderGateway},${ids.wrongGateway})) +
    (select count(*) from gateway_lease where org_id in (${ids.org},${ids.wrongOrg})) +
    (select count(*) from fin_products where org_id=${ids.org}) +
    (select count(*) from pos_settings where org_id=${ids.org}) +
    (select count(*) from member_roles where profile_id=${ids.profile}) +
    (select count(*) from organization_members where profile_id=${ids.profile}) as count`;
  assert.equal(Number(owned.count), 0, 'Owned fixture cleanup incomplete');
  const current =
    await sql`select id,gateway_id,agent_id,provisioning_status,updated_at::text from personal_agents order by id`;
  assert.equal(
    digest(current),
    receipt.existingAssignmentHash,
    'Existing assignments changed during QA',
  );
  receipt.cleanup = {
    ownedRowsRemaining: 0,
    existingAssignmentsUnchanged: true,
    gatewayStopped: !gateway || gateway.exitCode !== null || gateway.signalCode !== null,
  };
  await sql.end();
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  // Preserve the secret-free receipt when using the default scratch path.
  for (const name of ['gateway.json', 'state', 'home', 'workspace'])
    await rm(join(scratch, name), { recursive: true, force: true });
  console.log(JSON.stringify({ pass: receipt.pass, receiptFile, cleanup: receipt.cleanup }));
}
