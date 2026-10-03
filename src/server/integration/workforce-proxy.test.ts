import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  admitHubIdentity,
  type HubIdentityAdmission,
} from '@minion-stack/workforce-client/hub-identity-contract';
import { mintIdentity } from '@minion-stack/workforce-client/identity-jwt';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const SECRET = Buffer.alloc(32, 7).toString('base64');
const COMPANY_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_COMPANY_ID = '10000000-0000-4000-8000-000000000002';
const CLAIMS = {
  userId: 'hub-user',
  email: 'admin@qa.minion.test',
  name: 'Hub Admin',
  companyId: COMPANY_ID,
  roleKeys: ['operator', 'staff'],
};
const REQUEST = {
  secret: SECRET,
  header: undefined,
  path: `/companies/${COMPANY_ID}/dashboard`,
};

async function rawToken(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ ...CLAIMS, ...overrides })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1m')
    .sign(new Uint8Array(Buffer.from(SECRET, 'base64')));
}

function expectRejected(
  admission: HubIdentityAdmission,
  expected: { status: 401 | 403; error: string },
) {
  expect(admission).toEqual({ kind: 'rejected', ...expected });
}

describe('reviewed Workforce identity contract artifact', () => {
  it('installs the exact provenance-pinned runtime contract', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('deps/workforce-contract-provenance.json', ROOT), 'utf8'),
    ) as {
      schemaVersion: number;
      baseVersion: string;
      baseIntegrity: string;
      artifact: string;
      sha256: string;
      sourceRepository: string;
      sourceCommit: string;
      sourceTree: string;
      contractExport: string;
      version: string;
    };
    expect(provenance).toMatchObject({
      schemaVersion: 1,
      baseVersion: '0.3.0',
      baseIntegrity:
        'sha512-6lOD60XIXDM4ykyzp7erMLhooCGFje92o/V3Sqv5ocjfU1NJkCw7kJpC75JvvkL9XG48+lH1BPsbl6+EQU0trA==',
      sourceRepository: 'NikolasP98/minion-meta',
      sourceCommit: 'f4171a635d45d54038adf8d4be285b06275f6ac2',
      contractExport: '@minion-stack/workforce-client/hub-identity-contract',
      version: '0.4.0-readiness.1',
    });
    expect(provenance.sourceTree).toMatch(/^[a-f0-9]{40}$/);
    const artifact = readFileSync(new URL(`deps/${provenance.artifact}`, ROOT));
    expect(createHash('sha256').update(artifact).digest('hex')).toBe(provenance.sha256);
    const manifest = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['@minion-stack/workforce-client']).toBe(
      `file:deps/${provenance.artifact}`,
    );
    expect(admitHubIdentity).toBeTypeOf('function');
  });
});

describe('Hub-minted identity through the Paperclip runtime admission contract', () => {
  it.each(['board', 'agent'])(
    'preserves an authenticated %s actor when no header exists',
    async (existingActorType) => {
      expect(await admitHubIdentity({ ...REQUEST, existingActorType })).toEqual({
        kind: 'existing-actor',
      });
    },
  );

  it.each([undefined, 'admin', 'anonymous'])(
    'rejects unsupported actor %s without a federation header',
    async (existingActorType) => {
      expectRejected(await admitHubIdentity({ ...REQUEST, existingActorType }), {
        status: 401,
        error: 'missing_hub_identity',
      });
    },
  );

  it('rejects a supplied malformed identity instead of falling back to a bearer actor', async () => {
    expectRejected(
      await admitHubIdentity({
        ...REQUEST,
        header: 'not.a.jwt',
        existingActorType: 'board',
      }),
      { status: 401, error: 'invalid_hub_identity' },
    );
  });

  it('accepts a real Hub-minted token at its matching company path', async () => {
    const header = await mintIdentity({ secret: SECRET, claims: CLAIMS, ttlSeconds: 60 });
    expect(await admitHubIdentity({ ...REQUEST, header })).toEqual({
      kind: 'identity',
      identity: CLAIMS,
    });
  });

  it('rejects non-UUID company claims before consumer persistence', async () => {
    expectRejected(
      await admitHubIdentity({
        ...REQUEST,
        header: await rawToken({ companyId: 'company-abc' }),
      }),
      { status: 401, error: 'invalid_hub_identity' },
    );
  });

  it('rejects a valid identity at another company path', async () => {
    expectRejected(
      await admitHubIdentity({
        ...REQUEST,
        path: `/companies/${OTHER_COMPANY_ID}/dashboard`,
        header: await rawToken(),
      }),
      { status: 403, error: 'company_scope_mismatch' },
    );
  });

  it('normalizes and deduplicates valid legacy role keys', async () => {
    expect(
      await admitHubIdentity({
        ...REQUEST,
        header: await rawToken({ roleKeys: [' owner ', 'staff', 'owner'] }),
      }),
    ).toMatchObject({
      kind: 'identity',
      identity: { roleKeys: ['owner', 'staff'] },
    });
  });

  it.each([null, ['bad role'], [4], Array(21).fill('owner')])(
    'rejects malformed role keys %j',
    async (roleKeys) => {
      expectRejected(await admitHubIdentity({ ...REQUEST, header: await rawToken({ roleKeys }) }), {
        status: 401,
        error: 'invalid_hub_identity',
      });
    },
  );
});
