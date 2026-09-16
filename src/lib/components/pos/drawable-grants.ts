/**
 * Which of a client's package grants can draw a session RIGHT NOW.
 *
 * `status` is already derived server-side (`pos-accounts.logic.ts` `grantStatus`,
 * shipped on every `GET /api/pos/packages/grants` / `GET /api/pos/accounts/:key`
 * row) — this is just the UI-facing pick: only 'active' is offerable, and
 * offered grants sort soonest-expiring first so staff draw down the package
 * closest to lapsing before a fresher one.
 */
export interface DrawableGrant {
  grant: { id: string; expiresAt: string | null };
  status: string;
}

export function drawableGrants<T extends DrawableGrant>(grants: T[]): T[] {
  return grants
    .filter((g) => g.status === 'active')
    .sort((a, b) =>
      (a.grant.expiresAt ?? '9999-99-99').localeCompare(b.grant.expiresAt ?? '9999-99-99'),
    );
}
