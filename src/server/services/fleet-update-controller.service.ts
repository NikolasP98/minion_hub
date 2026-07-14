import { env } from '$env/dynamic/private';

export interface ImageArtifact {
  image?: string;
  digest?: string;
  version?: string;
}

export interface ExternalRolloutRequest {
  operationId: string;
  controllerId: string;
  targetVersion: string;
  targetArtifact: ImageArtifact;
}

export interface ExternalRolloutStatus {
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: string | null;
}

export interface ExternalRolloutResult {
  artifact?: ImageArtifact;
}

function parseImage(value: string): { registry: string; repository: string } {
  const withoutDigest = value.split('@', 1)[0];
  const slash = withoutDigest.indexOf('/');
  if (slash < 1) throw new Error(`external image must include a registry: ${value}`);
  const registry = withoutDigest.slice(0, slash);
  let repository = withoutDigest.slice(slash + 1);
  const colon = repository.lastIndexOf(':');
  if (colon > repository.lastIndexOf('/')) repository = repository.slice(0, colon);
  return { registry, repository };
}

async function registryRequest(
  url: string,
  repository: string,
  authorization?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: [
      'application/vnd.oci.image.index.v1+json',
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.docker.distribution.manifest.list.v2+json',
      'application/vnd.docker.distribution.manifest.v2+json',
    ].join(', '),
  };
  if (authorization) headers.authorization = authorization;
  let response = await fetch(url, { method: 'HEAD', headers });
  if (response.status !== 401) return response;

  const challenge = response.headers.get('www-authenticate') ?? '';
  const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
  if (!realm) return response;
  if (realm !== 'https://ghcr.io/token') throw new Error('container registry returned an untrusted token realm');
  const service = /service="([^"]+)"/.exec(challenge)?.[1];
  const scope = /scope="([^"]+)"/.exec(challenge)?.[1] ?? `repository:${repository}:pull`;
  const tokenUrl = new URL(realm);
  if (service) tokenUrl.searchParams.set('service', service);
  tokenUrl.searchParams.set('scope', scope);
  const tokenHeaders: Record<string, string> = {};
  if (env.MINION_FLEET_UPDATE_REGISTRY_TOKEN) {
    const actor = env.MINION_FLEET_UPDATE_REGISTRY_USER;
    if (!actor) throw new Error('container registry authentication requires MINION_FLEET_UPDATE_REGISTRY_USER');
    tokenHeaders.authorization = `Basic ${Buffer.from(`${actor}:${env.MINION_FLEET_UPDATE_REGISTRY_TOKEN}`).toString('base64')}`;
  }
  const tokenResponse = await fetch(tokenUrl, { headers: tokenHeaders });
  if (!tokenResponse.ok) throw new Error(`container registry token request failed (${tokenResponse.status})`);
  const tokenBody = (await tokenResponse.json()) as { token?: string; access_token?: string };
  const token = tokenBody.token ?? tokenBody.access_token;
  if (!token) throw new Error('container registry token response omitted token');
  response = await fetch(url, { method: 'HEAD', headers: { ...headers, authorization: `Bearer ${token}` } });
  return response;
}

/** Resolve a mutable deployment tag to one immutable digest before a job starts. */
export async function resolveExternalImageTarget(
  _controllerId: string,
  currentArtifacts: ImageArtifact[],
): Promise<ImageArtifact> {
  const image = env.MINION_FLEET_UPDATE_IMAGE;
  if (!image) throw new Error('external image target resolution requires MINION_FLEET_UPDATE_IMAGE');
  const tag = env.MINION_FLEET_UPDATE_IMAGE_TAG || 'prd';
  const { registry, repository } = parseImage(image);
  if (registry !== 'ghcr.io') throw new Error('external image registry must be ghcr.io');
  // currentArtifacts are observation only. Never let a gateway choose the
  // registry authority or repository to which credentials are sent.
  for (const current of currentArtifacts) {
    if (!current.image) continue;
    const reported = parseImage(current.image);
    if (reported.registry !== registry || reported.repository !== repository) {
      throw new Error('gateway reported an image outside the configured repository');
    }
  }
  const taggedImage = `${registry}/${repository}:${tag}`;
  const url = `https://${registry}/v2/${repository}/manifests/${encodeURIComponent(tag)}`;
  const response = await registryRequest(url, repository);
  if (!response.ok) throw new Error(`container registry manifest resolution failed (${response.status})`);
  const digest = response.headers.get('docker-content-digest');
  if (!digest) throw new Error('container registry response omitted Docker-Content-Digest');
  return { image: taggedImage, digest };
}

/**
 * Privileged image replacement stays outside gateway containers. The default
 * controller is a GitHub Actions workflow; installations may replace this
 * adapter without changing the fleet state machine.
 */
export async function dispatchExternalImageRollout(
  request: ExternalRolloutRequest,
): Promise<ExternalRolloutResult> {
  const token = env.GITHUB_TOKEN;
  const repo = env.MINION_FLEET_UPDATE_GITHUB_REPO;
  const workflow = env.MINION_FLEET_UPDATE_GITHUB_WORKFLOW;
  const ref = env.MINION_FLEET_UPDATE_GITHUB_REF || 'main';
  if (!token || !repo || !workflow) {
    throw new Error(
      'external image controller is not configured (GITHUB_TOKEN, MINION_FLEET_UPDATE_GITHUB_REPO, MINION_FLEET_UPDATE_GITHUB_WORKFLOW)',
    );
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        ref,
        inputs: {
          controller_id: request.controllerId,
          operation_id: request.operationId,
          target_version: request.targetVersion,
          target_image: request.targetArtifact.image ?? '',
          target_digest: request.targetArtifact.digest ?? '',
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`external image controller dispatch failed (${response.status})`);
  }
  return { artifact: request.targetArtifact };
}

export async function getExternalImageRolloutStatus(
  operationId: string,
): Promise<ExternalRolloutStatus | null> {
  const token = env.GITHUB_TOKEN;
  const repo = env.MINION_FLEET_UPDATE_GITHUB_REPO;
  const workflow = env.MINION_FLEET_UPDATE_GITHUB_WORKFLOW;
  if (!token || !repo || !workflow) throw new Error('external image controller is not configured');
  const url = new URL(
    `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`,
  );
  url.searchParams.set('event', 'workflow_dispatch');
  url.searchParams.set('per_page', '30');
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`external image controller status failed (${response.status})`);
  const body = (await response.json()) as {
    workflow_runs?: Array<{ display_title?: string; name?: string; status?: string; conclusion?: string | null }>;
  };
  const run = body.workflow_runs?.find(
    (candidate) =>
      candidate.display_title?.includes(operationId) || candidate.name?.includes(operationId),
  );
  if (!run || !['queued', 'in_progress', 'completed'].includes(run.status ?? '')) return null;
  return {
    status: run.status as ExternalRolloutStatus['status'],
    conclusion: run.conclusion,
  };
}
