/**
 * Guard for spec 2026-08-17-hub-dead-mirrors-cleanup-spec.
 *
 * The hub used to carry local *mirrors* of declarations that `@minion-stack/*`
 * now publishes. Each mirror carried a "delete me once the package ships it"
 * TODO, the package shipped it, and the mirror stayed — quietly free to drift
 * away from the contract it claims to describe.
 *
 * This guard makes the class un-reintroducible:
 *   1. the retired mirror files must not exist;
 *   2. no file under `src/` or `scripts/` may reference their module
 *      specifiers (the last real caller of the schema mirror lived in
 *      `scripts/`, so a `src/`-only scan would not have seen it);
 *   3. the canonical replacement must still carry the exact surface the hub
 *      depends on — a grep guard cannot see the package drifting.
 *
 * Ownership: these two slices were implemented twice in parallel — here, and
 * bundled into open PR #159 (`orch/hub-small-trio`, which also carries
 * unrelated IGV / brain-vector / finance work and re-declares `SECRETS_METHODS`
 * locally instead of importing it as a value). That collision is resolved in
 * the canonical ledger, not in this comment: minion-meta
 * `proposals/2026-08-17-hub-dead-mirrors-cleanup.md` § "Implementation
 * ownership (2026-08-29)" assigns both slices to this PR (#196) and records
 * #159's disposition. (An earlier attempt, PR #138, was closed without merge.)
 *
 * TODO(handoff): PR #159 still carries its own copy of both slices — the two
 * mirror deletions, the `src/server/db/schema/index.ts` and
 * `scripts/backfill-workspaces.ts` re-points, and its own version of this
 * guard file. Per the ledger disposition above, whichever PR lands second must
 * drop that overlap on rebase (preserving #159's unrelated work); a branch
 * cannot rebase or close another PR, so that step is a maintainer action.
 * Ledger entry: minion-meta `proposals/2026-08-17-hub-dead-mirrors-cleanup.md`.
 * Spec: minion-meta `specs/2026-08-17-hub-dead-mirrors-cleanup-spec.md`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRETS_METHODS } from '@minion-stack/shared';
import { workspaceMembership } from '@minion-stack/db/schema';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

/** `src/` — this file lives at `src/lib/no-dead-mirrors.test.ts`. */
const SRC_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(SRC_ROOT, '..');
const SELF = join(import.meta.dirname, 'no-dead-mirrors.test.ts');

/** Retired mirrors: path under the repo root, and the specifier importers used. */
const DEAD_MIRRORS = [
  { file: 'src/lib/types/secrets.ts', specifier: 'lib/types/secrets' },
  {
    file: 'src/server/db/schema/workspace-membership.ts',
    specifier: 'db/schema/workspace-membership',
  },
] as const;

/** Hand-written trees that may import a mirror. `scripts/` is not under `src/`. */
const SCAN_ROOTS = ['src', 'scripts'] as const;

/** Generated i18n output — thousands of files, none of them hand-written. */
const SKIP_DIRS = new Set(['paraglide']);

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkSource(join(dir, entry.name), out);
    } else if (/\.(ts|js|svelte)$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe('no dead mirrors', () => {
  it.each(DEAD_MIRRORS)('$file has been deleted', ({ file }) => {
    expect(existsSync(join(REPO_ROOT, file))).toBe(false);
  });

  it('no hand-written file references a retired mirror', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walkSource(join(REPO_ROOT, root))) {
        if (file === SELF) continue;
        const content = readFileSync(file, 'utf8');
        for (const { specifier } of DEAD_MIRRORS) {
          if (content.includes(specifier)) offenders.push(`${file} → ${specifier}`);
        }
      }
    }
    expect(
      offenders,
      'these files still import a retired mirror; import the canonical @minion-stack package instead',
    ).toEqual([]);
  });

  // The greps above prove the mirrors are gone. The two below prove the
  // replacements are real — a deletion is only safe while the canonical
  // declaration still matches what the hub deleted.

  // SECRETS_METHODS is the hub's only wire-name table for the `secrets.*` RPCs,
  // and its camelCase keys deliberately differ from the snake_case wire
  // strings, so a silent rename in the package would break the Security tab
  // with no type error at all.
  it('@minion-stack/shared still exports the secrets wire-name table verbatim', () => {
    expect(SECRETS_METHODS).toEqual({
      list: 'secrets.list',
      set: 'secrets.set',
      clear: 'secrets.clear',
      probe: 'secrets.probe',
      setScoped: 'secrets.set_scoped',
      clearScoped: 'secrets.clear_scoped',
      probeScoped: 'secrets.probe_scoped',
    });
  });

  // `workspace_membership` holds live production rows and is under an explicit
  // "no destructive drop" ruling (2026-06-14-workforce-org-company-bridge-design),
  // so the canonical declaration must keep describing the *same physical table*
  // the deleted mirror described: same name, columns, PK, index, and FK action.
  it('@minion-stack/db still declares workspace_membership as the hub mirror did', () => {
    const t = getTableConfig(workspaceMembership);

    expect(t.name).toBe('workspace_membership');
    expect(
      t.columns.map((c) => ({
        name: c.name,
        type: c.columnType,
        notNull: c.notNull,
        default: c.default ?? null,
      })),
    ).toEqual([
      { name: 'user_id', type: 'SQLiteText', notNull: true, default: null },
      { name: 'paperclip_company_id', type: 'SQLiteText', notNull: true, default: null },
      { name: 'role', type: 'SQLiteText', notNull: true, default: 'admin' },
      { name: 'created_at', type: 'SQLiteTimestamp', notNull: true, default: null },
    ]);
    expect(t.primaryKeys.map((pk) => pk.columns.map((c) => c.name))).toEqual([
      ['user_id', 'paperclip_company_id'],
    ]);
    expect(t.indexes.map((i) => ({ name: i.config.name, unique: i.config.unique }))).toEqual([
      { name: 'idx_workspace_membership_user', unique: false },
    ]);
    expect(
      t.foreignKeys.map((fk) => {
        const ref = fk.reference();
        return {
          columns: ref.columns.map((c) => c.name),
          foreignTable: getTableConfig(ref.foreignTable).name,
          foreignColumns: ref.foreignColumns.map((c) => c.name),
          onDelete: fk.onDelete ?? null,
        };
      }),
    ).toEqual([
      {
        columns: ['user_id'],
        foreignTable: 'user',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
    ]);
  });
});
