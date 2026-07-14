import { beforeEach, describe, expect, test, vi } from 'vitest';

const { privateEnv } = vi.hoisted(() => ({ privateEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));

import {
  dispatchExternalImageRollout,
  getExternalImageRolloutStatus,
  resolveExternalImageTarget,
} from './fleet-update-controller.service';

beforeEach(() => {
  for (const key of Object.keys(privateEnv)) delete privateEnv[key];
  vi.unstubAllGlobals();
});

describe('resolveExternalImageTarget', () => {
  test('authenticates to GHCR and resolves the prd tag to an immutable digest', async () => {
    privateEnv.MINION_FLEET_UPDATE_IMAGE = 'ghcr.io/owner/minion:prd';
    privateEnv.MINION_FLEET_UPDATE_REGISTRY_TOKEN = 'registry-secret';
    privateEnv.MINION_FLEET_UPDATE_REGISTRY_USER = 'owner';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:owner/minion:pull"',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'registry-token' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:target' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolveExternalImageTarget('swarm:prod/minion', [
        { image: 'ghcr.io/owner/minion@sha256:old', digest: 'sha256:old' },
      ]),
    ).resolves.toEqual({ image: 'ghcr.io/owner/minion:prd', digest: 'sha256:target' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.authorization).toBe('Bearer registry-token');
  });

  test('rejects an untrusted registry token realm without sending credentials', async () => {
    privateEnv.MINION_FLEET_UPDATE_IMAGE = 'ghcr.io/owner/minion:prd';
    privateEnv.MINION_FLEET_UPDATE_REGISTRY_TOKEN = 'registry-secret';
    privateEnv.MINION_FLEET_UPDATE_REGISTRY_USER = 'owner';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 401,
        headers: { 'www-authenticate': 'Bearer realm="https://evil.example/token"' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveExternalImageTarget('swarm:prod/minion', [])).rejects.toThrow('untrusted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('requires the configured GHCR repository and rejects gateway authority changes', async () => {
    privateEnv.MINION_FLEET_UPDATE_IMAGE = 'ghcr.io/owner/minion:prd';
    await expect(
      resolveExternalImageTarget('swarm:prod/minion', [{ image: 'evil.example/owner/minion:prd' }]),
    ).rejects.toThrow('outside the configured repository');
  });
});

describe('dispatchExternalImageRollout', () => {
  test('dispatches the configured workflow with controller id and exact digest', async () => {
    Object.assign(privateEnv, {
      GITHUB_TOKEN: 'secret',
      MINION_FLEET_UPDATE_GITHUB_REPO: 'owner/infra',
      MINION_FLEET_UPDATE_GITHUB_WORKFLOW: 'deploy.yml',
      MINION_FLEET_UPDATE_GITHUB_REF: 'main',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await dispatchExternalImageRollout({
      operationId: 'op-123',
      controllerId: 'swarm:prod/minion',
      targetVersion: '2026.7.12-dev.20260713023956',
      targetArtifact: { image: 'ghcr.io/owner/minion:prd', digest: 'sha256:target' },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.inputs).toMatchObject({
      controller_id: 'swarm:prod/minion',
      operation_id: 'op-123',
      target_digest: 'sha256:target',
    });
  });

  test('matches workflow run status by operation id without exposing response bodies', async () => {
    Object.assign(privateEnv, {
      GITHUB_TOKEN: 'workflow-secret',
      MINION_FLEET_UPDATE_GITHUB_REPO: 'owner/infra',
      MINION_FLEET_UPDATE_GITHUB_WORKFLOW: 'deploy.yml',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            workflow_runs: [
              { display_title: 'swarm rollout op-123', status: 'completed', conclusion: 'success' },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(getExternalImageRolloutStatus('op-123')).resolves.toEqual({
      status: 'completed',
      conclusion: 'success',
    });
  });
});
