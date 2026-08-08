import { env } from '$env/dynamic/private';

/**
 * The one place the hub talks to api.github.com.
 *
 * Extracted from github-issues.service.ts (which now imports it) so the repo
 * surfaces, the bug reporter and the marketplace share one token path, one set
 * of headers and one error shape.
 *
 * Ceiling: `env.GITHUB_TOKEN` is a SINGLE machine identity for every org. That
 * is fine while repo-linking is the MINION org's own tooling; a second tenant
 * linking a private repo needs a per-org GitHub App installation. The upgrade
 * is local to `resolveToken()` — no call site changes.
 * See specs/2026-08-07-projects-github-repos-and-factory-gates-spec.md §7.
 */
const GITHUB_API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string,
  ) {
    super(`GitHub ${status}: ${path} — ${detail}`);
    this.name = 'GitHubError';
  }
}

export function hasGitHubToken(): boolean {
  return !!env.GITHUB_TOKEN;
}

function resolveToken(): string {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new GitHubError(0, '', 'GITHUB_TOKEN not configured');
  return token;
}

/** `owner` and `repo` are interpolated into a URL — keep them to GitHub's own
 *  name grammar so a user-supplied link can never reach another host or path. */
const NAME_RE = /^[A-Za-z0-9._-]+$/;

export function isRepoName(owner: string, repo: string): boolean {
  return (
    NAME_RE.test(owner) &&
    NAME_RE.test(repo) &&
    owner.length <= 100 &&
    repo.length <= 100 &&
    !owner.startsWith('.') &&
    !repo.startsWith('.')
  );
}

export async function githubFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'minion-hub',
    Authorization: `Bearer ${resolveToken()}`,
  };
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${GITHUB_API}/${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GitHubError(res.status, path, detail);
  }
  return res.json() as Promise<T>;
}
