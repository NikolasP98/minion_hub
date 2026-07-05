import type { IgComment, FbComment } from '$server/services/meta/graph-read';

// Pure Graph-response → comment-item mappers for the comments endpoint. Live
// in a sibling module (not +server.ts) — same reason as ../media-mapping.ts:
// SvelteKit's production build rejects non-handler exports from route files.

export type Comment = {
  id: string;
  username: string;
  text: string;
  timestamp: string | null;
  likeCount: number;
  replies: Comment[];
};

/** IG comment (+ one level of replies) → the panel's Comment shape. Pure — unit-tested directly. */
export function mapIgComments(comments: IgComment[]): Comment[] {
  return comments.map((c) => ({
    id: c.id,
    username: c.username ?? '',
    text: c.text ?? '',
    timestamp: c.timestamp ?? null,
    likeCount: c.like_count ?? 0,
    replies: (c.replies?.data ?? []).map((r) => ({
      id: r.id,
      username: r.username ?? '',
      text: r.text ?? '',
      timestamp: r.timestamp ?? null,
      likeCount: r.like_count ?? 0,
      replies: [],
    })),
  }));
}

/** FB comment → the panel's Comment shape. No nested-replies edge requested (out of scope v1). Pure — unit-tested directly. */
export function mapFbComments(comments: FbComment[]): Comment[] {
  return comments.map((c) => ({
    id: c.id,
    username: c.from?.name ?? '',
    text: c.message ?? '',
    timestamp: c.created_time ?? null,
    likeCount: c.like_count ?? 0,
    replies: [],
  }));
}
