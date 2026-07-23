import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
  BRAIN_VECTOR_CONTRACT_VERSION,
  brainVectorCollectionName,
  brainVectorContentFingerprint,
  brainVectorSourceScopeHash,
  canonicalizeBrainVectorSourceIds,
  mintBrainVectorCapability,
  searchBrainVectorApi,
  type BrainVectorClientConfig,
} from './brain-vector-client';

let config: BrainVectorClientConfig;

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { extractable: true });
  config = {
    url: 'https://vectors.example.test/vectors',
    signingPrivateKey: await exportPKCS8(pair.privateKey),
    signingKid: 'fixture-kid',
    fingerprintKey: '0123456789abcdef0123456789abcdef',
    generation: 'openai_te3s_1536_g1',
    issuer: 'minion-hub',
    audience: 'minion-brain-vector',
    timeoutMs: 800,
  };
  Object.assign(config, { publicKey: pair.publicKey });
});

describe('brain vector shared cryptographic contract', () => {
  it('matches the published cross-repo source-scope fixture', () => {
    expect(brainVectorSourceScopeHash(['7f-source', '1a-source', '7f-source'])).toBe(
      'sha256:v1:gemxrtsXdAz07R5K44ohdNWe4xD_Otb7vHicOD_Bn3g',
    );
  });

  it('rejects whitespace and non-ASCII source IDs rather than normalizing them', () => {
    expect(() => canonicalizeBrainVectorSourceIds(['source-a', ' '])).toThrow(
      'source IDs must use only ASCII',
    );
    expect(() => canonicalizeBrainVectorSourceIds(['source-💡'])).toThrow(
      'source IDs must use only ASCII',
    );
  });

  it('matches the published cross-repo content-fingerprint fixture', () => {
    const key = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index));
    expect(
      brainVectorContentFingerprint(
        key,
        '018f87f4-e934-7a21-98b6-4f6b8d3898dd',
        'sha256:8f83665f2b7ac3ec',
        'openai_te3s_1536_g1',
      ),
    ).toBe('hmac-sha256:v1:huYmtzmlJ6XYRgPOuJEnCMOd3IRyOmqUKHdca3q3h6w');
  });

  it('mints a short-lived Ed25519 capability bound to org, brain, generation, and sources', async () => {
    const pair = await generateKeyPair('EdDSA', { extractable: true });
    const privateKey = await exportPKCS8(pair.privateKey);
    const token = await mintBrainVectorCapability(
      { ...config, signingPrivateKey: privateKey },
      {
        orgId: 'org-1',
        brainId: '11111111-1111-4111-8111-111111111111',
        subject: 'profile-1',
        sourceIds: ['7f-source', '1a-source'],
      },
      1_000,
    );
    const verified = await jwtVerify(token, pair.publicKey, {
      issuer: 'minion-hub',
      audience: 'minion-brain-vector',
      currentDate: new Date(1_030_000),
    });
    expect(verified.protectedHeader).toMatchObject({
      alg: 'EdDSA',
      typ: 'JWT',
      kid: 'fixture-kid',
    });
    expect(verified.payload).toMatchObject({
      sub: 'profile-1',
      org_id: 'org-1',
      brain_id: '11111111-1111-4111-8111-111111111111',
      generation: 'openai_te3s_1536_g1',
      source_scope_mode: 'source_list',
      source_scope_hash: 'sha256:v1:gemxrtsXdAz07R5K44ohdNWe4xD_Otb7vHicOD_Bn3g',
      op: 'search',
      iat: 1_000,
      exp: 1_060,
    });
    expect(verified.payload.jti).toEqual(expect.any(String));
  });
});

describe('brain vector API client', () => {
  it('canonicalizes source IDs and validates the serving generation', async () => {
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe('https://vectors.example.test/vectors/v1/search');
      const body = JSON.parse(String(init?.body)) as {
        contractVersion: number;
        filters: { scopeMode: string; sourceIds: string[] };
      };
      expect(body.filters.sourceIds).toEqual(['source-a', 'source-b']);
      expect(body).toMatchObject({
        contractVersion: BRAIN_VECTOR_CONTRACT_VERSION,
        filters: { scopeMode: 'source_list' },
      });
      expect(init?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer /) });
      return Response.json({
        contractVersion: BRAIN_VECTOR_CONTRACT_VERSION,
        generation: config.generation,
        collection: brainVectorCollectionName(config.generation),
        tookMs: 12,
        candidates: [
          {
            chunkId: '11111111-1111-4111-8111-111111111111',
            score: 0.8,
            indexedFingerprint: 'hmac-sha256:v1:huYmtzmlJ6XYRgPOuJEnCMOd3IRyOmqUKHdca3q3h6w',
          },
        ],
      });
    });
    const result = await searchBrainVectorApi(
      config,
      {
        orgId: 'org-1',
        brainId: '22222222-2222-4222-8222-222222222222',
        subject: 'profile-1',
        vector: Array.from({ length: 1536 }, () => 0),
        limit: 20,
        filters: {
          scopeMode: 'source_list',
          sourceIds: ['source-b', 'source-a', 'source-b'],
        },
      },
      fetchImpl as typeof fetch,
    );
    expect(result.candidates).toHaveLength(1);
  });

  it('rejects a generation mismatch instead of accepting an unknown collection', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ generation: 'wrong', collection: 'shadow', tookMs: 1, candidates: [] }),
    );
    await expect(
      searchBrainVectorApi(
        config,
        {
          orgId: 'org-1',
          brainId: '22222222-2222-4222-8222-222222222222',
          subject: 'profile-1',
          vector: Array.from({ length: 1536 }, () => 0),
          limit: 20,
          filters: { scopeMode: 'source_list', sourceIds: ['source-a'] },
        },
        fetchImpl as typeof fetch,
      ),
    ).rejects.toThrow(/mismatched generation/);
  });

  it('matches the shared collection fixture and rejects unsafe generations', () => {
    expect(brainVectorCollectionName('openai_te3s_1536_g1')).toBe(
      'minion_brains_v1__openai_te3s_1536_g1',
    );
    expect(() => brainVectorCollectionName('Bad-Generation')).toThrow('generation must be');
    expect(() => brainVectorCollectionName('a'.repeat(65))).toThrow('generation must be');
  });

  it('rejects overlong source IDs and kinds before sending a request', async () => {
    await expect(
      searchBrainVectorApi(config, {
        orgId: 'org-1',
        brainId: '22222222-2222-4222-8222-222222222222',
        subject: 'profile-1',
        vector: Array.from({ length: 1536 }, () => 0),
        limit: 20,
        filters: { scopeMode: 'source_list', sourceIds: ['s'.repeat(129)] },
      }),
    ).rejects.toThrow('source IDs must use only ASCII');
    await expect(
      searchBrainVectorApi(config, {
        orgId: 'org-1',
        brainId: '22222222-2222-4222-8222-222222222222',
        subject: 'profile-1',
        vector: Array.from({ length: 1536 }, () => 0),
        limit: 20,
        filters: { scopeMode: 'source_list', sourceIds: ['source-a'], kinds: ['k'.repeat(65)] },
      }),
    ).rejects.toThrow('kinds are invalid');
  });

  it('rejects impossible UTC calendar instants before sending a request', async () => {
    const fetchImpl = vi.fn();
    await expect(
      searchBrainVectorApi(
        config,
        {
          orgId: 'org-1',
          brainId: '22222222-2222-4222-8222-222222222222',
          subject: 'profile-1',
          vector: Array.from({ length: 1536 }, () => 0),
          limit: 20,
          filters: {
            scopeMode: 'source_list',
            sourceIds: ['source-a'],
            occurredAfter: '2026-02-30T00:00:00Z',
          },
        },
        fetchImpl as typeof fetch,
      ),
    ).rejects.toThrow('dates must be RFC 3339 UTC');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts non-empty canonical chunk IDs including UUIDv7/v8 shapes', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        contractVersion: BRAIN_VECTOR_CONTRACT_VERSION,
        generation: config.generation,
        collection: brainVectorCollectionName(config.generation),
        tookMs: 1,
        candidates: [
          {
            chunkId: '018f87f4-e934-7a21-98b6-4f6b8d3898dd',
            score: 0.8,
            indexedFingerprint: 'fingerprint-v1',
          },
          {
            chunkId: '018f87f4-e934-8a21-98b6-4f6b8d3898dd',
            score: 0.7,
            indexedFingerprint: 'fingerprint-v1',
          },
        ],
      }),
    );
    const result = await searchBrainVectorApi(
      config,
      {
        orgId: 'org-1',
        brainId: '22222222-2222-4222-8222-222222222222',
        subject: 'profile-1',
        vector: Array.from({ length: 1536 }, () => 0),
        limit: 2,
        filters: { scopeMode: 'source_list', sourceIds: ['source-a'] },
      },
      fetchImpl as typeof fetch,
    );
    expect(result.candidates.map((candidate) => candidate.chunkId)).toEqual([
      '018f87f4-e934-7a21-98b6-4f6b8d3898dd',
      '018f87f4-e934-8a21-98b6-4f6b8d3898dd',
    ]);
  });

  it('rejects a response with more candidates than the originating request limit', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        contractVersion: BRAIN_VECTOR_CONTRACT_VERSION,
        generation: config.generation,
        collection: brainVectorCollectionName(config.generation),
        tookMs: 1,
        candidates: [
          { chunkId: 'chunk-1', score: 0.8, indexedFingerprint: 'fingerprint-v1' },
          { chunkId: 'chunk-2', score: 0.7, indexedFingerprint: 'fingerprint-v1' },
        ],
      }),
    );
    await expect(
      searchBrainVectorApi(
        config,
        {
          orgId: 'org-1',
          brainId: '22222222-2222-4222-8222-222222222222',
          subject: 'profile-1',
          vector: Array.from({ length: 1536 }, () => 0),
          limit: 1,
          filters: { scopeMode: 'source_list', sourceIds: ['source-a'] },
        },
        fetchImpl as typeof fetch,
      ),
    ).rejects.toThrow('too many candidates');
  });

  it('fails closed on org_all until the Hub can prove all-source policy scope', async () => {
    await expect(
      searchBrainVectorApi(config, {
        orgId: 'org-1',
        brainId: '22222222-2222-4222-8222-222222222222',
        subject: 'profile-1',
        vector: Array.from({ length: 1536 }, () => 0),
        limit: 20,
        filters: { scopeMode: 'org_all' },
      }),
    ).rejects.toThrow(/org_all vector scope is not implemented/);
  });
});

describe('brain vector outbox migration contract', () => {
  const migration = readFileSync(
    new URL('../../../supabase/migrations/20260723010000_brain_vector_outbox.sql', import.meta.url),
    'utf8',
  );

  it('installs inert generation control and delete-precedence trigger semantics', () => {
    expect(migration).toContain(
      "values ('openai_te3s_1536_g1', 'text-embedding-3-small', 1536, false, true)",
    );
    expect(migration).toContain("operation := 'delete'");
    expect(migration).toContain('revision = public.brain_vector_outbox.revision + 1');
    expect(migration).toContain("status = 'queued'");
    expect(migration).toContain("generation ~ '^[a-z0-9_]{1,64}$'");
  });

  it('uses revision-matched ACK deletion and RPC-only worker authority', () => {
    expect(migration).toContain('delete from public.brain_vector_outbox o');
    expect(migration).toContain('and o.revision = ack_brain_vector_job.revision');
    expect(migration).toContain('create role brain_vector_worker nologin noinherit nobypassrls');
    expect(migration).toContain(
      'grant execute on function public.claim_brain_vector_jobs(text, integer, integer) to brain_vector_worker',
    );
    expect(migration).toContain(
      'grant execute on function public.enqueue_brain_vector_backfill(text, uuid, integer) to brain_vector_worker',
    );
    expect(migration).toContain(
      'grant execute on function public.brain_vector_worker_status(text) to brain_vector_worker',
    );
    expect(migration).toContain('unknown brain vector generation');
    expect(migration).toContain(
      'revoke all on public.brain_vector_outbox from public, anon, authenticated, app_ledger',
    );
  });

  it('returns reconcile generation and reports canonical org while rejecting oversized filters', () => {
    expect(migration).toContain('g.generation, k.source_id');
    expect(migration).toContain(
      'filter_existing_brain_vector_chunks accepts at most 1000 chunk IDs',
    );
    expect(migration).toContain("using errcode = '22023'");
    expect(migration).toContain('select k.id, k.org_id, k.content_hash, k.embedding_model');
  });
});
