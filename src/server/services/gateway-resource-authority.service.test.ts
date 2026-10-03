import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ db: null as unknown, keys: [] as JWK[] }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => fixture.db }));
vi.mock('./gateway-jwt.service', () => ({
  gatewayJwtIssuer: () => 'https://hub.example.test',
  getJwksPublicKeys: async () => fixture.keys,
}));

import { authorizeWorkshopSave } from './gateway-resource-authority.service';
import { GET } from '../../routes/api/internal/workshop/saves/[id]/authority/+server';

const db = new PGlite();
const sqlDb = drizzle(db);
const userId = '00000000-0000-4000-8000-000000000001';
const orgA = '00000000-0000-4000-8000-00000000000a';
const orgB = '00000000-0000-4000-8000-00000000000b';
const gatewayId = '00000000-0000-4000-8000-000000000010';
const aliasId = '00000000-0000-4000-8000-000000000011';
const saveId = 'legacy/workshop%2Fα';
let signingKey: CryptoKey;
let userJwt: string;

async function token(
  overrides: Record<string, unknown> = {},
  options: { issuer?: string; audience?: string; jti?: false; expiry?: string | number } = {},
) {
  const jwt = new SignJWT({ userId, orgId: orgA, role: 'user', agentIds: ['main'], ...overrides })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'fixture' })
    .setSubject(userId)
    .setIssuer(options.issuer ?? 'https://hub.example.test')
    .setAudience(options.audience ?? 'openclaw-gateway')
    .setIssuedAt()
    .setExpirationTime(options.expiry ?? '1h');
  if (options.jti !== false) jwt.setJti('unique-token');
  return jwt.sign(signingKey);
}
function input(overrides: Partial<Parameters<typeof authorizeWorkshopSave>[0]> = {}) {
  return {
    saveId,
    authorization: 'Bearer machine-secret',
    userJwt,
    serverId: 'legacy-machine',
    ...overrides,
  };
}

beforeAll(async () => {
  const keys = await generateKeyPair('EdDSA', { extractable: true });
  signingKey = keys.privateKey;
  fixture.keys = [{ ...(await exportJWK(keys.publicKey)), kid: 'fixture' }];
  fixture.db = {
    select: sqlDb.select.bind(sqlDb),
    execute: async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const query = new PgDialect().sqlToQuery(statement);
      return (await db.query(query.sql, query.params)).rows;
    },
  };
  await db.exec(`
    create table gateway (id uuid primary key, legacy_server_id text, url text, org_id uuid,
      token_ciphertext text, token_iv text, auth_mode text);
    create table organization_members (profile_id uuid, organization_id uuid);
    create table channels (gateway_id uuid, tenant_id uuid);
    create table workshop_saves (id text primary key, tenant_id uuid);
  `);
});
beforeEach(async () => {
  userJwt = await token();
  await db.exec('truncate gateway,organization_members,channels,workshop_saves');
  await db.query(
    "insert into gateway values ($1,'legacy-machine','wss://gateway.test',$2,'machine-secret','','token')",
    [gatewayId, orgA],
  );
  await db.query('insert into organization_members values ($1,$2),($1,$3)', [userId, orgA, orgB]);
  await db.query('insert into workshop_saves values ($1,$2)', [saveId, orgA]);
});
afterAll(() => db.close());

describe('workshop authority with signed JWTs and real PostgreSQL queries', () => {
  it('authorizes the exact legacy text ID and active membership', async () => {
    await expect(authorizeWorkshopSave(input())).resolves.toEqual({ saveId, orgId: orgA });
  });
  it('preserves shared gateway channel assignments across organizations', async () => {
    await db.query('update gateway set org_id=$1', [orgB]);
    await db.query('insert into channels values ($1,$2)', [gatewayId, orgA]);
    await expect(authorizeWorkshopSave(input())).resolves.toEqual({ saveId, orgId: orgA });
  });
  it('accepts same URL and credential aliases without granting different credentials', async () => {
    await db.query('update gateway set org_id=$1', [orgB]);
    await db.query(
      "insert into gateway values ($1,'alias','wss://gateway.test',$2,'different','','token')",
      [aliasId, orgA],
    );
    await expect(authorizeWorkshopSave(input())).rejects.toMatchObject({ status: 403 });
    await db.query("update gateway set token_ciphertext='machine-secret' where id=$1", [aliasId]);
    await expect(authorizeWorkshopSave(input())).resolves.toEqual({ saveId, orgId: orgA });
  });
  it('rejects a valid user from the wrong save organization', async () => {
    await db.query('insert into channels values ($1,$2)', [gatewayId, orgB]);
    await expect(
      authorizeWorkshopSave(input({ userJwt: await token({ orgId: orgB }) })),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rechecks membership and credential rotation on each admission', async () => {
    await authorizeWorkshopSave(input());
    await db.query('delete from organization_members where organization_id=$1', [orgA]);
    await expect(authorizeWorkshopSave(input())).rejects.toMatchObject({ status: 403 });
    await db.query('insert into organization_members values ($1,$2)', [userId, orgA]);
    await db.exec("update gateway set token_ciphertext='rotated'");
    await expect(authorizeWorkshopSave(input())).rejects.toMatchObject({ status: 401 });
  });
  it('does not decrypt unrelated machines or accept an unrelated hint', async () => {
    await db.query(
      "insert into gateway values ($1,'other','wss://other.test',$2,'broken','invalid','token')",
      [aliasId, orgB],
    );
    await expect(authorizeWorkshopSave(input())).resolves.toEqual({ saveId, orgId: orgA });
    await expect(authorizeWorkshopSave(input({ serverId: 'absent' }))).rejects.toMatchObject({
      status: 401,
    });
  });
  it.each([{ userJwt: null }, { authorization: null }, { serverId: null }, { userJwt: 'forged' }])(
    'requires both credentials and the machine hint: %j',
    async (override) => {
      await expect(authorizeWorkshopSave(input(override))).rejects.toMatchObject({ status: 401 });
    },
  );
  it('authenticates before reporting an invalid save identifier', async () => {
    await expect(
      authorizeWorkshopSave(input({ saveId: 'x'.repeat(120), userJwt: null })),
    ).rejects.toMatchObject({ status: 401 });
    await expect(authorizeWorkshopSave(input({ saveId: 'x'.repeat(120) }))).rejects.toMatchObject({
      status: 404,
    });
  });
  it('rejects signed malformed user/org claims', async () => {
    await expect(
      authorizeWorkshopSave(input({ userJwt: await token({ userId: 'another' }) })),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authorizeWorkshopSave(input({ userJwt: await token({ orgId: null }) })),
    ).rejects.toMatchObject({ status: 401 });
  });
  it.each([
    { issuer: 'https://attacker.test' },
    { audience: 'different-service' },
    { jti: false as const },
    { expiry: 1 },
  ])('rejects invalid signed JWT contract %j', async (options) => {
    await expect(
      authorizeWorkshopSave(input({ userJwt: await token({}, options) })),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('has no admin bypass for another organization or unscoped legacy save', async () => {
    await db.query('update workshop_saves set tenant_id=null');
    await expect(
      authorizeWorkshopSave(input({ userJwt: await token({ role: 'admin' }) })),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('returns no-store and an explicit 503 on unavailable canonical storage', async () => {
    const event = {
      params: { id: saveId },
      request: new Request('https://hub.example.test/authority', {
        headers: {
          authorization: 'Bearer machine-secret',
          'x-minion-user-jwt': userJwt,
          'x-minion-server-id': 'legacy-machine',
        },
      }),
    } as Parameters<typeof GET>[0];
    const ok = await GET(event);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const actualDb = fixture.db;
    fixture.db = {
      select() {
        throw new Error('database unavailable');
      },
    };
    try {
      const failed = await GET(event);
      expect(failed.status).toBe(503);
      expect(failed.headers.get('cache-control')).toBe('no-store');
      expect(await failed.json()).toEqual({ error: 'Workshop authority unavailable' });
    } finally {
      fixture.db = actualDb;
    }
  });
});

describe('installed SvelteKit path compatibility', () => {
  it.each(['legacy/workshop%2Fα', '%25', 'plain-id', 'space and ?#'])(
    'preserves text save ID %s through actual route decoding',
    async (id) => {
      const routingPath = new URL(
        '../../../node_modules/@sveltejs/kit/src/utils/routing.js',
        import.meta.url,
      ).href;
      const urlPath = new URL(
        '../../../node_modules/@sveltejs/kit/src/utils/url.js',
        import.meta.url,
      ).href;
      const { parse_route_id, find_route } = await import(/* @vite-ignore */ routingPath);
      const { decode_pathname } = await import(/* @vite-ignore */ urlPath);
      const route = parse_route_id('/api/internal/workshop/saves/[id]/authority');
      const pathname = `/api/internal/workshop/saves/${encodeURIComponent(id)}/authority`;
      const match = find_route(decode_pathname(pathname), [route], {});
      expect(match?.params.id).toBe(id);
    },
  );
});
