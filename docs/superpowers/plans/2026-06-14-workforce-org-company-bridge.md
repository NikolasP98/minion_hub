# Workforce ↔ Org→Paperclip-Company Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active hub org (Supabase `organizations`) drive `/workforce`'s Paperclip company, so selecting an org scopes the Kanban plugin to that org's company instead of showing "No company is currently selected".

**Architecture:** Add a `paperclip_company_id` column to Supabase `organizations` (backfilled for existing FACES/MINION companies). A new server helper resolves/provisions the org→company mapping. The `paperclipIdentityHandle` hook derives `companyId` from the active org's mapping (scoped to workforce paths). A new `workforce/+layout.server.ts` gate lazily provisions a company for orgs that have none, then exposes the id to child loads via `locals.paperclipIdentity.companyId`.

**Tech Stack:** SvelteKit 2 (server hooks + load fns), Supabase JS (`supabaseAdmin()`), `@minion-stack/paperclip-client`, vitest (bun).

**Spec:** `specs/2026-06-14-workforce-org-company-bridge-design.md` (meta-repo root).

**Verified facts (2026-06-14):**
- Existing paperclip companies on netcup: FACES SCULPTORS `fea398fc-ca7f-4dc8-be3f-38b8725a51db`, MINION `a32be1cc-88e9-4207-a4da-cf818e3c91e9`, Pinonite corp. `3e721e98-0e5d-4d63-aa68-d1981270c7f6`.
- Supabase orgs: FACES SCULPTORS `21e0601b-f632-43fd-8414-d644af4271f4`, MINION `c9e8dc46-27b6-4aea-86a1-a2eb6b23be2d`.
- `resolveIdentity` sets `locals.tenantCtx.tenantId` = active org id (honors `active_org` cookie), and `locals.orgId`. Runs in `appHandle`, before `paperclipIdentityHandle`.
- Company create requires board-key actor `isInstanceAdmin` (paperclip `companies.ts:268`); listing/reading does not. Backfill avoids create for existing orgs.

**Run all commands from `minion_hub/` unless stated. Test runner: `bun run vitest run <file>`.**

---

### Task 1: Schema migration + backfill

**Files:**
- Create: `../supabase/migrations/20260614210000_org_paperclip_company.sql` (meta-repo root `supabase/migrations/`)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260614210000_org_paperclip_company.sql` at the meta-repo root:

```sql
-- Bridge hub org → paperclip company. One company per org.
alter table organizations add column if not exists paperclip_company_id text;

create unique index if not exists organizations_paperclip_company_id_key
  on organizations (paperclip_company_id)
  where paperclip_company_id is not null;

-- Backfill existing gw orgs to their already-provisioned paperclip companies
-- (verified 2026-06-14 via companies.list() against netcup). Pure backfill —
-- no creation, so the instance-admin create requirement does not apply here.
update organizations set paperclip_company_id = 'fea398fc-ca7f-4dc8-be3f-38b8725a51db'
  where id = '21e0601b-f632-43fd-8414-d644af4271f4' and paperclip_company_id is null; -- FACES SCULPTORS
update organizations set paperclip_company_id = 'a32be1cc-88e9-4207-a4da-cf818e3c91e9'
  where id = 'c9e8dc46-27b6-4aea-86a1-a2eb6b23be2d' and paperclip_company_id is null; -- MINION
-- Pinonite corp. (paperclip 3e721e98-…) has no matching gw org → left unmapped.
```

- [ ] **Step 2: Apply to the hub Supabase (gxv project) and verify**

Apply via the project's normal migration path (Supabase MCP `apply_migration`, or psql against the pooler). Then verify:

```sql
select name, paperclip_company_id from organizations order by name;
```
Expected: FACES SCULPTORS → `fea398fc-…`, MINION → `a32be1cc-…`.

- [ ] **Step 3: Commit**

```bash
cd .. && git add supabase/migrations/20260614210000_org_paperclip_company.sql
git -c commit.gpgsign=false commit -m "feat(db): organizations.paperclip_company_id + backfill FACES/MINION"
cd minion_hub
```

---

### Task 2: Helper — `getOrgCompanyId`

**Files:**
- Create: `src/lib/server/paperclip-company.ts`
- Test: `src/lib/server/paperclip-company.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/paperclip-company.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from }) }));

import { getOrgCompanyId } from './paperclip-company';

beforeEach(() => vi.clearAllMocks());

describe('getOrgCompanyId', () => {
  it('returns the mapped company id', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: 'co-1' }, error: null });
    const id = await getOrgCompanyId('org-1');
    expect(from).toHaveBeenCalledWith('organizations');
    expect(select).toHaveBeenCalledWith('paperclip_company_id');
    expect(eq).toHaveBeenCalledWith('id', 'org-1');
    expect(id).toBe('co-1');
  });

  it('returns null when unmapped', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: null }, error: null });
    expect(await getOrgCompanyId('org-1')).toBeNull();
  });

  it('returns null on error', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await getOrgCompanyId('org-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/lib/server/paperclip-company.test.ts`
Expected: FAIL — `getOrgCompanyId` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/server/paperclip-company.ts`:

```ts
import { supabaseAdmin } from '$server/supabase';

/**
 * org → paperclip company bridge. The active hub org (Supabase `organizations`)
 * owns exactly one paperclip company via `organizations.paperclip_company_id`.
 */

/** Read the paperclip company id mapped to a hub org. null if unmapped. */
export async function getOrgCompanyId(orgId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('organizations')
    .select('paperclip_company_id')
    .eq('id', orgId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { paperclip_company_id: string | null }).paperclip_company_id ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/lib/server/paperclip-company.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/paperclip-company.ts src/lib/server/paperclip-company.test.ts
git commit -m "feat(workforce): getOrgCompanyId org→company resolver"
```

---

### Task 3: Helper — `provisionOrgCompany` (idempotent, race-safe)

**Files:**
- Modify: `src/lib/server/paperclip-company.ts`
- Test: `src/lib/server/paperclip-company.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/server/paperclip-company.test.ts`. First, extend the mock block at the top of the file so `update().eq().is().select()` and the paperclip client are mockable. Replace the existing mock setup with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const selectRead = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));

// update().eq().is().select() chain → resolves to { data, error }
const updSelect = vi.fn();
const updIs = vi.fn(() => ({ select: updSelect }));
const updEq = vi.fn(() => ({ is: updIs }));
const update = vi.fn(() => ({ eq: updEq }));

const from = vi.fn((table: string) => {
  if (table !== 'organizations') throw new Error(`unexpected table ${table}`);
  return { select: selectRead, update };
});
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from }) }));

const companiesCreate = vi.fn();
const companiesArchive = vi.fn();
vi.mock('$lib/server/paperclip-fetch', () => ({
  paperclipServerClient: () => ({
    companies: { create: companiesCreate, archive: companiesArchive },
  }),
}));

import { getOrgCompanyId, provisionOrgCompany } from './paperclip-company';

beforeEach(() => vi.clearAllMocks());
```

Update the existing `getOrgCompanyId` tests to use `selectRead` instead of the old `select`/`eq` spies:
- `expect(from).toHaveBeenCalledWith('organizations')` stays.
- Drop the `expect(select)…`/`expect(eq)…` assertions (covered by the chain mock); keep the return-value assertions and drive them via `maybeSingle.mockResolvedValueOnce(...)`.

Then add the provisioning tests:

```ts
const fakeEvent = {} as any;

describe('provisionOrgCompany', () => {
  it('returns the existing mapping without creating', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: 'co-existing' }, error: null });
    const id = await provisionOrgCompany(fakeEvent, 'org-1', 'Acme');
    expect(id).toBe('co-existing');
    expect(companiesCreate).not.toHaveBeenCalled();
  });

  it('creates + persists when unmapped and wins the race', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: null }, error: null });
    companiesCreate.mockResolvedValueOnce({ id: 'co-new', name: 'Acme' });
    updSelect.mockResolvedValueOnce({ data: [{ paperclip_company_id: 'co-new' }], error: null });
    const id = await provisionOrgCompany(fakeEvent, 'org-1', 'Acme');
    expect(companiesCreate).toHaveBeenCalledWith({ name: 'Acme' });
    expect(update).toHaveBeenCalledWith({ paperclip_company_id: 'co-new' });
    expect(updEq).toHaveBeenCalledWith('id', 'org-1');
    expect(updIs).toHaveBeenCalledWith('paperclip_company_id', null);
    expect(id).toBe('co-new');
    expect(companiesArchive).not.toHaveBeenCalled();
  });

  it('archives the duplicate and returns the winner on a lost race', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { paperclip_company_id: null }, error: null }) // first read: unmapped
      .mockResolvedValueOnce({ data: { paperclip_company_id: 'co-winner' }, error: null }); // re-read: winner
    companiesCreate.mockResolvedValueOnce({ id: 'co-dup', name: 'Acme' });
    updSelect.mockResolvedValueOnce({ data: [], error: null }); // 0 rows → lost race
    companiesArchive.mockResolvedValueOnce({});
    const id = await provisionOrgCompany(fakeEvent, 'org-1', 'Acme');
    expect(id).toBe('co-winner');
    expect(companiesArchive).toHaveBeenCalledWith('co-dup');
  });

  it('propagates create failures (e.g. 403 not instance-admin)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: null }, error: null });
    companiesCreate.mockRejectedValueOnce(new Error('paperclip 403'));
    await expect(provisionOrgCompany(fakeEvent, 'org-1', 'Acme')).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run src/lib/server/paperclip-company.test.ts`
Expected: FAIL — `provisionOrgCompany` not exported.

- [ ] **Step 3: Implement `provisionOrgCompany`**

Append to `src/lib/server/paperclip-company.ts`:

```ts
import type { RequestEvent } from '@sveltejs/kit';
import { paperclipServerClient } from '$lib/server/paperclip-fetch';

/**
 * Ensure the org has a paperclip company, creating one named after the org if
 * not. Idempotent and race-safe: the persist is a conditional update gated on
 * `paperclip_company_id is null`; if a concurrent request won, we archive the
 * company we just created and return the winner.
 *
 * Throws if paperclip company creation fails (e.g. 403 when the hub board key is
 * not an instance admin). Callers should catch and route to /workforce/welcome.
 */
export async function provisionOrgCompany(
  event: RequestEvent,
  orgId: string,
  orgName: string,
): Promise<string> {
  const existing = await getOrgCompanyId(orgId);
  if (existing) return existing;

  const client = paperclipServerClient(event);
  const company = await client.companies.create({ name: orgName });

  const { data, error } = await supabaseAdmin()
    .from('organizations')
    .update({ paperclip_company_id: company.id })
    .eq('id', orgId)
    .is('paperclip_company_id', null)
    .select('paperclip_company_id');

  if (!error && Array.isArray(data) && data.length > 0) {
    return company.id; // we won the race
  }

  // Lost the race (or update no-op): a concurrent request mapped first.
  const winner = await getOrgCompanyId(orgId);
  if (winner && winner !== company.id) {
    await client.companies.archive(company.id).catch(() => {});
    return winner;
  }
  return winner ?? company.id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run src/lib/server/paperclip-company.test.ts`
Expected: PASS (getOrgCompanyId + 4 provisioning tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/paperclip-company.ts src/lib/server/paperclip-company.test.ts
git commit -m "feat(workforce): provisionOrgCompany idempotent race-safe provisioning"
```

---

### Task 4: Hook — derive `companyId` from the active org

**Files:**
- Modify: `src/hooks.server.ts:218-254` (`paperclipIdentityHandle`)

- [ ] **Step 1: Update the handle to resolve company from the org mapping**

Replace the body of `paperclipIdentityHandle` so `companyId` comes from the active org (scoped to workforce paths to avoid a Supabase read on every request). Edit `src/hooks.server.ts`:

Add the import near the other `$lib/server` imports at the top of the file:
```ts
import { getOrgCompanyId } from '$lib/server/paperclip-company';
```

Replace lines 218-254 (`const paperclipIdentityHandle …` through its closing `};`) with:

```ts
const paperclipIdentityHandle: Handle = async ({ event, resolve }) => {
  if (event.locals.user) {
    // Company is scoped to the active hub org. Only resolve it for routes that
    // actually consume it (the workforce UI + the paperclip proxy) so we don't
    // pay a Supabase read on every request. The pc_company_id cookie is no
    // longer the carrier (org is the source of truth); read it only as a
    // legacy fallback when no org mapping exists.
    const path = event.url.pathname;
    const needsCompany = path.startsWith('/workforce') || path.startsWith('/api/pc');
    const orgId = event.locals.orgId ?? event.locals.tenantCtx?.tenantId ?? null;
    let companyId: string | null = null;
    if (needsCompany) {
      companyId =
        (orgId ? await getOrgCompanyId(orgId) : null) ??
        event.cookies.get('pc_company_id') ??
        null;
    }

    const boardKey = env.HUB_PAPERCLIP_BOARD_KEY ?? null;
    if (boardKey) {
      event.locals.paperclipIdentity = {
        token: boardKey,
        companyId,
        userId: event.locals.user.id,
      };
    } else {
      try {
        const token = await mintPaperclipIdentity({
          userId: event.locals.user.id,
          email: event.locals.user.email ?? null,
          name: event.locals.user.displayName ?? null,
          companyId,
        });
        event.locals.paperclipIdentity = {
          token,
          companyId,
          userId: event.locals.user.id,
        };
      } catch (err) {
        console.warn('[paperclipIdentityHandle] no auth configured:', err);
      }
    }
  }
  return resolve(event);
};
```

- [ ] **Step 2: Type-check the hook change**

Run: `bun run check`
Expected: 0 errors, 0 warnings. (If `event.locals.orgId` is flagged, it is already declared in `App.Locals` — see `src/app.d.ts`; confirm and leave as-is.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks.server.ts
git commit -m "feat(workforce): derive paperclip companyId from active org in hook"
```

---

### Task 5: Workforce layout gate — lazy provisioning

**Files:**
- Create: `src/routes/(app)/workforce/+layout.server.ts`

- [ ] **Step 1: Write the layout load gate**

Create `src/routes/(app)/workforce/+layout.server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';
import { provisionOrgCompany } from '$lib/server/paperclip-company';
import type { LayoutServerLoad } from './$types';

/**
 * Single gate for the /workforce subtree. The active hub org owns one paperclip
 * company; if the org has none yet, lazily provision one named after the org and
 * expose its id to child loads via locals.paperclipIdentity.companyId (set in
 * the same request so child +page.server.ts loads see it).
 */
export const load: LayoutServerLoad = async (event) => {
  if (!event.locals.user) throw redirect(302, '/login');

  const orgId = event.locals.orgId ?? event.locals.tenantCtx?.tenantId ?? null;
  if (!orgId) throw redirect(302, '/workforce/welcome?reason=no-org');

  // Hook already resolved it for an existing mapping.
  let companyId = event.locals.paperclipIdentity?.companyId ?? null;

  if (!companyId) {
    // Look up the org name for the new company, then provision.
    const { data: org } = await supabaseAdmin()
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle();
    const orgName = (org as { name: string } | null)?.name ?? 'Workspace';
    try {
      companyId = await provisionOrgCompany(event, orgId, orgName);
    } catch (err) {
      console.warn('[workforce] provisioning failed', err);
      throw redirect(302, '/workforce/welcome?reason=provision-failed');
    }
    // Make the freshly-provisioned id visible to child page loads this request.
    if (event.locals.paperclipIdentity) {
      event.locals.paperclipIdentity.companyId = companyId;
    }
  }

  return { companyId };
};
```

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/routes/\(app\)/workforce/+layout.server.ts
git commit -m "feat(workforce): layout gate lazily provisions org's paperclip company"
```

---

### Task 6: Remove redundant redirect + welcome reasons

**Files:**
- Modify: `src/routes/(app)/workforce/+page.server.ts:8-11`
- Modify: `src/routes/(app)/workforce/welcome/+page.svelte`
- Create: `src/routes/(app)/workforce/welcome/+page.server.ts`

- [ ] **Step 1: Drop the now-redundant null-check in the dashboard load**

The layout is the single gate, so the dashboard page no longer needs its own redirect. In `src/routes/(app)/workforce/+page.server.ts`, remove lines 9-11:

```ts
	if (!event.locals.paperclipIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome');
	}
```

Also remove the now-unused `redirect` from the import on line 1 if nothing else uses it (it doesn't — only `error` remains):
```ts
import { error } from '@sveltejs/kit';
```

- [ ] **Step 2: Surface the reason on the welcome page**

Create `src/routes/(app)/workforce/welcome/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  const reason = event.url.searchParams.get('reason');
  return { reason };
};
```

- [ ] **Step 3: Update welcome copy to reflect the real causes**

Replace `src/routes/(app)/workforce/welcome/+page.svelte` with:

```svelte
<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	const message = $derived(
		data.reason === 'provision-failed'
			? "We couldn't set up a Workforce workspace for this organization. A paperclip instance admin needs to confirm the hub's board key, then reload."
			: data.reason === 'no-org'
				? 'No organization is selected. Pick an organization from the sidebar to use Workforce.'
				: 'Workforce is not available for this organization yet. Ask an instance admin to enable it.',
	);
</script>

<div class="p-8 max-w-lg">
	<h1 class="text-2xl font-semibold">Welcome</h1>
	<p class="mt-2 text-muted">{message}</p>
</div>
```

- [ ] **Step 4: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/routes/\(app\)/workforce/+page.server.ts src/routes/\(app\)/workforce/welcome/+page.svelte src/routes/\(app\)/workforce/welcome/+page.server.ts
git commit -m "feat(workforce): single layout gate + reason-aware welcome copy"
```

---

### Task 7: Full green + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: all pass (existing `paperclip-proxy.test.ts` still green; new `paperclip-company.test.ts` green).

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: succeeds (only the documented harmless optional-peer notices).

- [ ] **Step 4: Manual smoke (local dev against netcup paperclip)**

Run: `bun run dev`, log in, ensure FACES SCULPTORS is the active org, visit `/workforce`.
Expected: NO welcome screen — the dashboard loads scoped to company `fea398fc-…` (FAC issues). Switch org to MINION via the OrgPicker → `/workforce` reflects company `a32be1cc-…` (MIN issues). Existing FACES paperclip agents remain untouched.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "chore(workforce): verification fixups"
```

---

## Notes for the implementer

- **Branch:** do this on a feature branch off `dev` (hub convention), e.g. `git worktree add .worktrees/workforce-org-bridge -b feature/workforce-org-bridge origin/dev`. Copy `.env`/`.env.local` into the worktree (the `$env` typegen + the netcup paperclip URL/board key live there).
- **Do NOT** start the 525-commit paperclip upstream merge — explicitly deferred (see spec).
- **Deploy prereq for NEW orgs only:** lazy provisioning (Task 5) calls `companies.create`, which needs the netcup hub's `HUB_PAPERCLIP_BOARD_KEY` to belong to a paperclip instance-admin board user. FACES/MINION are backfilled so this isn't needed for them, but verify before relying on auto-provisioning for a new org.
- **`pc_company_id` / `/api/workspaces/select` / `workspace_membership`** are left in place (non-destructive) and only consulted as a legacy fallback. A later cleanup can remove them once this is verified in prod.
