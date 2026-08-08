import { env } from '$env/dynamic/private';

/**
 * Client for the preview runner — the service on the box where the sandbox
 * clones live (Netcup) that starts and stops per-branch dev servers.
 *
 * The hub runs on Vercel and has no shell on that box, so it cannot start a dev
 * server itself; it asks. This is the same shape as the workforce bridge: an
 * internal URL + a shared secret, and a capability probe so every surface
 * degrades honestly when the runner is absent.
 *
 * The runner itself lives in the `minion/` repo and is NOT built yet — until
 * `PREVIEW_RUNNER_URL` is set, `previewRunnerConfigured()` is false and the UI
 * says so rather than showing a dead button.
 *
 * Spec: specs/2026-08-07-projects-github-repos-and-factory-gates-spec.md §3b
 */

export type PreviewExposure = 'tailnet' | 'public';
export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'failed';

export type Preview = {
  id: string;
  repo: string;
  branch: string;
  status: PreviewStatus;
  exposure: PreviewExposure;
  url: string | null;
  port: number | null;
  startedAt: string | null;
  lastError: string | null;
};

export type PreviewFailure = 'not_configured' | 'unreachable' | 'rejected' | 'error';
export type PreviewResult<T> =
  { ok: true; data: T } | { ok: false; reason: PreviewFailure; detail?: string };

export function previewRunnerConfigured(): boolean {
  return !!env.PREVIEW_RUNNER_URL;
}

function baseUrl(): string {
  return (env.PREVIEW_RUNNER_URL ?? '').replace(/\/+$/, '');
}

function headers(): Record<string, string> {
  const secret = env.PREVIEW_RUNNER_SECRET;
  return {
    'Content-Type': 'application/json',
    ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
  };
}

/** 8s: a start request returns as soon as the container is SCHEDULED (status
 *  'starting'), so this never waits on a real dev-server boot. */
const TIMEOUT_MS = 8_000;

async function call<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<PreviewResult<T>> {
  if (!previewRunnerConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: headers(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 204) return { ok: true, data: undefined as T };
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // 4xx is the runner refusing (repo not allowlisted, cap reached) — a real
      // answer the user should see, not an outage.
      return {
        ok: false,
        reason: res.status >= 400 && res.status < 500 ? 'rejected' : 'error',
        detail: detail.slice(0, 500),
      };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

export function listPreviews(): Promise<PreviewResult<{ previews: Preview[] }>> {
  return call<{ previews: Preview[] }>('/previews');
}

/**
 * The hub never forwards a shell command. `repo` and `branch` are the only
 * inputs, and the runner validates `repo` against its own allowlist — a browser
 * cannot name an arbitrary repo to run (spec §3b security 1–2).
 */
export function startPreview(input: {
  repo: string;
  branch: string;
  exposure: PreviewExposure;
}): Promise<PreviewResult<Preview>> {
  return call<Preview>('/previews', { method: 'POST', body: input });
}

export function stopPreview(previewId: string): Promise<PreviewResult<void>> {
  return call<void>(`/previews/${encodeURIComponent(previewId)}`, { method: 'DELETE' });
}

/** Previews for one repo, or an empty list when the runner is absent/down. */
export async function previewsForRepo(repo: string): Promise<{
  previews: Preview[];
  available: boolean;
  reason: PreviewFailure | null;
}> {
  const res = await listPreviews();
  if (!res.ok) return { previews: [], available: false, reason: res.reason };
  return {
    previews: res.data.previews.filter((p) => p.repo === repo),
    available: true,
    reason: null,
  };
}
