import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { githubFetch, hasGitHubToken, isRepoName, GitHubError } from './github-api';
import { deriveGates, type GateLadder } from '$lib/workforce/factory-gates';

/**
 * Read/write surfaces for a project's linked GitHub repo — branches, PRs,
 * commits and reviews.
 *
 * Failure contract: NOTHING here throws into a page load. Every read returns
 * `Ok<T> | Err`, because an unguarded `await` in a SvelteKit `load` 500s the
 * whole route subtree (shipped twice — /en/channels layout, POS module states).
 * A GitHub outage must degrade one panel, not the project page.
 *
 * Spec: specs/2026-08-07-projects-github-repos-and-factory-gates-spec.md §4.2
 */

export type RepoRef = { owner: string; repo: string };

export type GhFailure = 'not_configured' | 'invalid_repo' | 'not_found' | 'rate_limited' | 'error';
export type GhResult<T> = { ok: true; data: T } | { ok: false; reason: GhFailure };

export type GhBranch = {
  name: string;
  sha: string;
  protected: boolean;
};

export type GhCommit = {
  sha: string;
  message: string;
  author: string | null;
  authoredAt: string | null;
  url: string;
};

export type GhPull = {
  number: number;
  title: string;
  author: string | null;
  headRef: string;
  baseRef: string;
  draft: boolean;
  url: string;
  updatedAt: string;
  labels: string[];
  ladder: GateLadder;
};

export type GhRepoMeta = {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  url: string;
};

export type ReviewDecision = 'approve' | 'request_changes' | 'comment';

const REVIEW_EVENT: Record<ReviewDecision, string> = {
  approve: 'APPROVE',
  request_changes: 'REQUEST_CHANGES',
  comment: 'COMMENT',
};

/** GitHub says 403 for both "forbidden" and "rate limited"; both mean "back off". */
function classify(err: unknown): GhFailure {
  if (err instanceof GitHubError) {
    if (err.status === 0) return 'not_configured';
    if (err.status === 404) return 'not_found';
    if (err.status === 403 || err.status === 429) return 'rate_limited';
  }
  return 'error';
}

async function attempt<T>(ref: RepoRef, run: () => Promise<T>): Promise<GhResult<T>> {
  if (!hasGitHubToken()) return { ok: false, reason: 'not_configured' };
  if (!isRepoName(ref.owner, ref.repo)) return { ok: false, reason: 'invalid_repo' };
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    return { ok: false, reason: classify(err) };
  }
}

const repoTag = (ref: RepoRef) => `gh-repo:${ref.owner}/${ref.repo}`;

/** Custom cache keys live under `d:` (keys.hub contract). */
function repoKey(orgId: string, ref: RepoRef, kind: string, extra: Record<string, string> = {}) {
  return keys.hub('gh-repo', {
    t: orgId,
    d: { r: `${ref.owner}/${ref.repo}`, k: kind, ...extra },
  });
}

/** 60s is short enough that a decision made on github.com shows up promptly and
 *  long enough that flipping between project tabs is free. */
const READ_CACHE = { ttl: '60s', swr: '5m' } as const;

// ── raw GitHub payload shapes (only the fields we read) ──────────────────────
type RawBranch = { name: string; commit: { sha: string }; protected?: boolean };
type RawCommit = {
  sha: string;
  html_url: string;
  commit: { message: string; author?: { name?: string; date?: string } };
  author?: { login?: string } | null;
};
type RawPull = {
  number: number;
  title: string;
  draft?: boolean;
  html_url: string;
  updated_at: string;
  user?: { login?: string } | null;
  head: { ref: string };
  base: { ref: string };
  labels?: Array<{ name: string }>;
};
type RawReview = { state: string; submitted_at: string | null };
type RawFile = { filename: string };
type RawRepo = {
  full_name: string;
  default_branch: string;
  private: boolean;
  html_url: string;
};

// ── reads ────────────────────────────────────────────────────────────────────

export function getRepoMeta(orgId: string, ref: RepoRef): Promise<GhResult<GhRepoMeta>> {
  return attempt(ref, () =>
    cached(repoKey(orgId, ref, 'meta'), { ...READ_CACHE, tags: [repoTag(ref)] }, async () => {
      const raw = await githubFetch<RawRepo>(`repos/${ref.owner}/${ref.repo}`);
      return {
        fullName: raw.full_name,
        defaultBranch: raw.default_branch,
        private: raw.private,
        url: raw.html_url,
      };
    }),
  );
}

/** Link-time validation. Deliberately uncached: a typo must not stick for 60s. */
export function verifyRepo(ref: RepoRef): Promise<GhResult<GhRepoMeta>> {
  return attempt(ref, async () => {
    const raw = await githubFetch<RawRepo>(`repos/${ref.owner}/${ref.repo}`);
    return {
      fullName: raw.full_name,
      defaultBranch: raw.default_branch,
      private: raw.private,
      url: raw.html_url,
    };
  });
}

export function listBranches(orgId: string, ref: RepoRef): Promise<GhResult<GhBranch[]>> {
  return attempt(ref, () =>
    cached(repoKey(orgId, ref, 'branches'), { ...READ_CACHE, tags: [repoTag(ref)] }, async () => {
      const raw = await githubFetch<RawBranch[]>(
        `repos/${ref.owner}/${ref.repo}/branches?per_page=50`,
      );
      return raw.map((b) => ({ name: b.name, sha: b.commit.sha, protected: !!b.protected }));
    }),
  );
}

export function listCommits(
  orgId: string,
  ref: RepoRef,
  branch?: string | null,
): Promise<GhResult<GhCommit[]>> {
  const sha = branch && isRepoName(branch.replace(/\//g, '-'), 'x') ? branch : null;
  return attempt(ref, () =>
    cached(
      repoKey(orgId, ref, 'commits', { b: sha ?? '' }),
      { ...READ_CACHE, tags: [repoTag(ref)] },
      async () => {
        const query = sha ? `?sha=${encodeURIComponent(sha)}&per_page=30` : '?per_page=30';
        const raw = await githubFetch<RawCommit[]>(
          `repos/${ref.owner}/${ref.repo}/commits${query}`,
        );
        return raw.map((c) => ({
          sha: c.sha,
          message: c.commit.message.split('\n')[0]!.slice(0, 200),
          author: c.author?.login ?? c.commit.author?.name ?? null,
          authoredAt: c.commit.author?.date ?? null,
          url: c.html_url,
        }));
      },
    ),
  );
}

/**
 * Open PRs with their derived gate ladder. Each PR costs two extra calls
 * (files + reviews), so this is capped at MAX_LADDER_PRS — beyond that the PR
 * still lists, with an empty ladder, rather than silently disappearing.
 */
const MAX_LADDER_PRS = 10;

export function listPulls(orgId: string, ref: RepoRef): Promise<GhResult<GhPull[]>> {
  return attempt(ref, () =>
    cached(repoKey(orgId, ref, 'pulls'), { ...READ_CACHE, tags: [repoTag(ref)] }, async () => {
      const raw = await githubFetch<RawPull[]>(
        `repos/${ref.owner}/${ref.repo}/pulls?state=open&per_page=30&sort=updated&direction=desc`,
      );
      return Promise.all(
        raw.map(async (pr, i) => {
          const labels = (pr.labels ?? []).map((l) => l.name);
          let files: string[] = [];
          let reviews: RawReview[] = [];
          if (i < MAX_LADDER_PRS) {
            [files, reviews] = await Promise.all([
              githubFetch<RawFile[]>(
                `repos/${ref.owner}/${ref.repo}/pulls/${pr.number}/files?per_page=100`,
              )
                .then((rows) => rows.map((f) => f.filename))
                .catch(() => [] as string[]),
              githubFetch<RawReview[]>(
                `repos/${ref.owner}/${ref.repo}/pulls/${pr.number}/reviews?per_page=100`,
              ).catch(() => [] as RawReview[]),
            ]);
          }
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? null,
            headRef: pr.head.ref,
            baseRef: pr.base.ref,
            draft: !!pr.draft,
            url: pr.html_url,
            updatedAt: pr.updated_at,
            labels,
            ladder: deriveGates({
              files,
              labels,
              reviews: reviews.map((r) => ({ state: r.state, submittedAt: r.submitted_at })),
            }),
          } satisfies GhPull;
        }),
      );
    }),
  );
}

// ── write ────────────────────────────────────────────────────────────────────

/**
 * Post a real GitHub review. This is the ONLY durable record of a gate
 * decision — the hub stores nothing.
 *
 * `attribution` is appended to the body because the review itself is authored
 * by the PAT's identity, not the signed-in hub user (spec §7).
 */
export function submitReview(
  ref: RepoRef,
  input: { number: number; decision: ReviewDecision; body: string; attribution: string },
): Promise<GhResult<{ id: number }>> {
  return attempt(ref, async () => {
    if (!Number.isInteger(input.number) || input.number <= 0) {
      throw new GitHubError(400, 'pulls', 'invalid pull number');
    }
    const body = `${input.body.trim()}\n\n— ${input.attribution}`;
    const res = await githubFetch<{ id: number }>(
      `repos/${ref.owner}/${ref.repo}/pulls/${input.number}/reviews`,
      {
        method: 'POST',
        body: JSON.stringify({ event: REVIEW_EVENT[input.decision], body }),
      },
    );
    return { id: res.id };
  });
}

export function bustRepoCache(ref: RepoRef) {
  return invalidateTags([repoTag(ref)]);
}

/** Re-exported so callers don't need a second import for the tag helper. */
export { tags };
